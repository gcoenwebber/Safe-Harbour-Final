import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import './ChatRoom.css';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ChatMessage {
    id: string;
    case_token: string;
    sender_type: 'reviewer' | 'victim';
    display_name: string;
    content: string;
    created_at: string;
}

interface ChatRoomProps {
    caseToken: string;
    userType: 'reviewer' | 'victim';
    onClose?: () => void;
}

export function ChatRoom({ caseToken, userType, onClose }: ChatRoomProps) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [participantCount, setParticipantCount] = useState(0);
    const [typingUser, setTypingUser] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize socket connection
    useEffect(() => {
        const newSocket = io(SOCKET_URL, {
            transports: ['websocket', 'polling']
        });

        newSocket.on('connect', () => {
            console.log('Socket connected');
            setIsConnected(true);
            setError(null);

            // Join the room
            newSocket.emit('join_room', {
                case_token: caseToken,
                user_type: userType
            });
        });

        newSocket.on('disconnect', () => {
            console.log('Socket disconnected');
            setIsConnected(false);
        });

        newSocket.on('error', (data: { message: string }) => {
            setError(data.message);
        });

        newSocket.on('room_joined', (data: { display_name: string; participant_count: number }) => {
            setDisplayName(data.display_name);
            setParticipantCount(data.participant_count);
        });

        newSocket.on('chat_history', (history: ChatMessage[]) => {
            setMessages(history);
        });

        newSocket.on('new_message', (message: ChatMessage) => {
            setMessages(prev => [...prev, message]);
        });

        newSocket.on('user_joined', (data: { display_name: string; participant_count: number }) => {
            setParticipantCount(data.participant_count);
            // Add system message
            setMessages(prev => [...prev, {
                id: `system-${Date.now()}`,
                case_token: caseToken,
                sender_type: 'reviewer',
                display_name: 'System',
                content: `${data.display_name} joined the chat`,
                created_at: new Date().toISOString()
            }]);
        });

        newSocket.on('user_left', (data: { display_name: string; participant_count: number }) => {
            setParticipantCount(data.participant_count);
            setMessages(prev => [...prev, {
                id: `system-${Date.now()}`,
                case_token: caseToken,
                sender_type: 'reviewer',
                display_name: 'System',
                content: `${data.display_name} left the chat`,
                created_at: new Date().toISOString()
            }]);
        });

        newSocket.on('user_typing', (data: { display_name: string }) => {
            setTypingUser(data.display_name);
        });

        newSocket.on('user_stopped_typing', () => {
            setTypingUser(null);
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [caseToken, userType]);

    const handleSendMessage = useCallback(() => {
        if (!socket || !inputValue.trim()) return;

        socket.emit('send_message', { content: inputValue.trim() });
        setInputValue('');
        socket.emit('stop_typing');
    }, [socket, inputValue]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);

        if (socket) {
            socket.emit('typing');

            // Clear previous timeout
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }

            // Set new timeout to emit stop_typing
            typingTimeoutRef.current = setTimeout(() => {
                socket.emit('stop_typing');
            }, 2000);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const formatTime = (dateString: string) => {
        return new Date(dateString).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isOwnMessage = (message: ChatMessage) => {
        return message.display_name === displayName;
    };

    return (
        <div className="chat-room">
            <header className="chat-header">
                <div className="chat-info">
                    <h3>Secure Enquiry Chat</h3>
                    <span className="case-token">Case: {caseToken.slice(0, 9)}...</span>
                </div>
                <div className="chat-status">
                    <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                        {isConnected ? '● Online' : '○ Offline'}
                    </span>
                    <span className="participant-count">{participantCount} participant{participantCount !== 1 ? 's' : ''}</span>
                    {onClose && (
                        <button className="close-btn" onClick={onClose}>×</button>
                    )}
                </div>
            </header>

            {error && (
                <div className="chat-error">
                    {error}
                </div>
            )}

            <div className="messages-container">
                {messages.length === 0 ? (
                    <div className="no-messages">
                        <p>No messages yet. Start the conversation!</p>
                        <p className="privacy-note">
                            🔒 This chat is anonymous and encrypted
                        </p>
                    </div>
                ) : (
                    messages.map((message) => (
                        <div
                            key={message.id}
                            className={`message ${isOwnMessage(message) ? 'own' : ''} ${message.display_name === 'System' ? 'system' : ''}`}
                        >
                            {message.display_name !== 'System' && (
                                <div className="message-header">
                                    <span className={`sender-name ${message.sender_type}`}>
                                        {message.display_name}
                                    </span>
                                    <span className="message-time">{formatTime(message.created_at)}</span>
                                </div>
                            )}
                            <div className="message-content">{message.content}</div>
                        </div>
                    ))
                )}
                {typingUser && (
                    <div className="typing-indicator">
                        {typingUser} is typing...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container">
                <input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message..."
                    disabled={!isConnected}
                    className="chat-input"
                />
                <button
                    onClick={handleSendMessage}
                    disabled={!isConnected || !inputValue.trim()}
                    className="send-btn"
                >
                    Send
                </button>
            </div>

            <div className="chat-footer">
                <span>You are: <strong>{displayName || 'Connecting...'}</strong></span>
            </div>
        </div>
    );
}

export default ChatRoom;
