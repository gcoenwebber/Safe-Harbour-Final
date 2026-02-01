import { useState, useCallback } from 'react';
import { MentionsInput, Mention } from 'react-mentions';
import type { SuggestionDataItem } from 'react-mentions';
import './MentionInput.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface MentionInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    organizationId?: string;
}

interface UserSuggestion extends SuggestionDataItem {
    role?: string;
}

export function MentionInput({ value, onChange, placeholder, organizationId }: MentionInputProps) {
    const [isLoading, setIsLoading] = useState(false);

    const fetchUsers = useCallback(async (query: string, callback: (data: UserSuggestion[]) => void) => {
        console.log('[MentionInput] fetchUsers called with query:', query, 'orgId:', organizationId);

        if (!query || query.length < 1) {
            console.log('[MentionInput] Query too short, returning empty');
            callback([]);
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ q: query });
            if (organizationId) {
                params.append('org', organizationId);
            }

            const url = `${API_BASE}/api/directory/search?${params}`;
            console.log('[MentionInput] Fetching:', url);

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Search failed');
            }

            const results = await response.json();
            console.log('[MentionInput] Results:', results);
            callback(results);
        } catch (error) {
            console.error('[MentionInput] Error fetching users:', error);
            callback([]);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId]);

    const renderSuggestion = (
        suggestion: SuggestionDataItem,
        _search: string,
        _highlightedDisplay: React.ReactNode,
        _index: number,
        focused: boolean
    ) => {
        const user = suggestion as UserSuggestion;
        return (
            <div className={`mention-suggestion ${focused ? 'focused' : ''}`}>
                <span className="mention-name">{user.display}</span>
                {user.role && <span className="mention-role">{user.role}</span>}
            </div>
        );
    };

    return (
        <div className="mention-input-container">
            <MentionsInput
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || "Type @ to mention someone..."}
                className="mention-input"
                allowSpaceInQuery
            >
                <Mention
                    trigger="@"
                    data={fetchUsers}
                    markup="@[__display__](__id__)"
                    displayTransform={(_id, display) => `@${display}`}
                    renderSuggestion={renderSuggestion}
                    appendSpaceOnAdd
                />
            </MentionsInput>
            {isLoading && <span className="mention-loading">Searching...</span>}
        </div>
    );
}

export default MentionInput;
