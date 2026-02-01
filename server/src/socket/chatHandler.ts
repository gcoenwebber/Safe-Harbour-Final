import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { supabase } from '../config/supabase';
import { isValidCaseToken } from '../utils/caseToken';

interface ChatMessage {
    id?: string;
    case_token: string;
    sender_type: 'reviewer' | 'victim';
    display_name: string;
    content: string;
    created_at?: string;
}

interface JoinRoomData {
    case_token: string;
    user_type: 'reviewer' | 'victim';
}

// Track active rooms and participants
const activeRooms = new Map<string, Set<string>>();

/**
 * Get display name based on user type and case token
 */
function getDisplayName(userType: 'reviewer' | 'victim', caseToken: string): string {
    if (userType === 'reviewer') {
        return 'Reviewer';
    }
    // Show last 4 characters of token for victim identification
    const tokenSuffix = caseToken.replace(/-/g, '').slice(-4).toUpperCase();
    return `Victim (Token-${tokenSuffix})`;
}

/**
 * Validate that the case token exists in the reports table
 */
async function validateCaseToken(caseToken: string): Promise<boolean> {
    if (!supabase || !isValidCaseToken(caseToken)) {
        return false;
    }

    const { data, error } = await supabase
        .from('reports')
        .select('id')
        .eq('case_token', caseToken)
        .single();

    return !error && !!data;
}

/**
 * Load chat history for a room
 */
async function loadChatHistory(caseToken: string): Promise<ChatMessage[]> {
    if (!supabase) {
        return [];
    }

    const { data, error } = await supabase
        .from('enquiry_messages')
        .select('id, case_token, sender_type, display_name, content, created_at')
        .eq('case_token', caseToken)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading chat history:', error);
        return [];
    }

    return data || [];
}

/**
 * Save a message to the database
 */
async function saveMessage(message: ChatMessage): Promise<ChatMessage | null> {
    if (!supabase) {
        return null;
    }

    const { data, error } = await supabase
        .from('enquiry_messages')
        .insert({
            case_token: message.case_token,
            sender_type: message.sender_type,
            display_name: message.display_name,
            content: message.content
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving message:', error);
        return null;
    }

    return data;
}

/**
 * Initialize Socket.io server with chat handling
 */
export function initializeSocketServer(httpServer: HttpServer): SocketServer {
    const io = new SocketServer(httpServer, {
        cors: {
            origin: ['http://localhost:5173', 'http://localhost:3000'],
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log(`Client connected: ${socket.id}`);

        let currentRoom: string | null = null;
        let currentUserType: 'reviewer' | 'victim' | null = null;
        let currentDisplayName: string | null = null;

        // Handle room join
        socket.on('join_room', async (data: JoinRoomData) => {
            const { case_token, user_type } = data;

            // Validate case token format
            if (!isValidCaseToken(case_token)) {
                socket.emit('error', { message: 'Invalid case token format' });
                return;
            }

            // Validate case token exists
            const isValid = await validateCaseToken(case_token);
            if (!isValid) {
                socket.emit('error', { message: 'Case token not found' });
                return;
            }

            // Leave previous room if any
            if (currentRoom) {
                socket.leave(currentRoom);
                const roomParticipants = activeRooms.get(currentRoom);
                if (roomParticipants) {
                    roomParticipants.delete(socket.id);
                    if (roomParticipants.size === 0) {
                        activeRooms.delete(currentRoom);
                    }
                }
            }

            // Join new room
            currentRoom = case_token;
            currentUserType = user_type;
            currentDisplayName = getDisplayName(user_type, case_token);

            socket.join(case_token);

            // Track participants
            if (!activeRooms.has(case_token)) {
                activeRooms.set(case_token, new Set());
            }
            activeRooms.get(case_token)!.add(socket.id);

            console.log(`${currentDisplayName} joined room: ${case_token}`);

            // Load and send chat history
            const history = await loadChatHistory(case_token);
            socket.emit('chat_history', history);

            // Notify room of new participant
            socket.to(case_token).emit('user_joined', {
                display_name: currentDisplayName,
                participant_count: activeRooms.get(case_token)!.size
            });

            // Confirm join to sender
            socket.emit('room_joined', {
                case_token,
                display_name: currentDisplayName,
                participant_count: activeRooms.get(case_token)!.size
            });
        });

        // Handle sending messages
        socket.on('send_message', async (data: { content: string }) => {
            if (!currentRoom || !currentUserType || !currentDisplayName) {
                socket.emit('error', { message: 'You must join a room first' });
                return;
            }

            const content = data.content?.trim();
            if (!content) {
                socket.emit('error', { message: 'Message cannot be empty' });
                return;
            }

            // Create message object
            const message: ChatMessage = {
                case_token: currentRoom,
                sender_type: currentUserType,
                display_name: currentDisplayName,
                content
            };

            // Save to database
            const savedMessage = await saveMessage(message);

            if (savedMessage) {
                // Broadcast to all room members (including sender)
                io.to(currentRoom).emit('new_message', savedMessage);
            } else {
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Handle typing indicator
        socket.on('typing', () => {
            if (currentRoom && currentDisplayName) {
                socket.to(currentRoom).emit('user_typing', {
                    display_name: currentDisplayName
                });
            }
        });

        socket.on('stop_typing', () => {
            if (currentRoom && currentDisplayName) {
                socket.to(currentRoom).emit('user_stopped_typing', {
                    display_name: currentDisplayName
                });
            }
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);

            if (currentRoom) {
                const roomParticipants = activeRooms.get(currentRoom);
                if (roomParticipants) {
                    roomParticipants.delete(socket.id);

                    // Notify remaining participants
                    socket.to(currentRoom).emit('user_left', {
                        display_name: currentDisplayName,
                        participant_count: roomParticipants.size
                    });

                    // Clean up empty rooms
                    if (roomParticipants.size === 0) {
                        activeRooms.delete(currentRoom);
                    }
                }
            }
        });
    });

    console.log('📡 Socket.io server initialized');
    return io;
}
