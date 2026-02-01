import { Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { supabase } from '../config/supabase';

interface NEREntity {
    text: string;
    start: number;
    end: number;
    label: string;
    uin: string | null;
}

interface NERResult {
    entities: NEREntity[];
    error?: string;
}

interface KnownName {
    name: string;
    uin: string;
}

/**
 * Strip @[Name](UIN) mentions and replace with UIN placeholders
 * Returns the cleaned text and extracted UINs
 */
function stripMentionMarkups(text: string): { text: string; mentionedUins: string[] } {
    const mentionRegex = /@\[([^\]]+)\]\((\d{10})\)/g;
    const mentionedUins: string[] = [];

    const cleanedText = text.replace(mentionRegex, (_match, _name, uin) => {
        mentionedUins.push(uin);
        return `[UIN:${uin}]`;
    });

    return { text: cleanedText, mentionedUins };
}

/**
 * Fetch known names from public_directory for NER matching
 */
async function fetchKnownNames(organizationId: string): Promise<KnownName[]> {
    if (!supabase) {
        console.warn('Supabase not configured, skipping known names fetch');
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('public_directory')
            .select('full_name, uin')
            .eq('organization_id', organizationId);

        if (error) {
            console.error('Error fetching known names:', error);
            return [];
        }

        return (data || []).map(row => ({
            name: row.full_name,
            uin: row.uin
        }));
    } catch (err) {
        console.error('Failed to fetch known names:', err);
        return [];
    }
}

/**
 * Run Python NER script to extract PERSON entities
 */
function runNERExtraction(text: string, knownNames: KnownName[]): Promise<NERResult> {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'ner_extract.py');

        const pythonProcess = spawn('python', [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('error', (err) => {
            // Python not available, return empty result (graceful degradation)
            console.warn('Python NER not available:', err.message);
            resolve({ entities: [] });
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0 && stderr) {
                console.warn('NER script warning:', stderr);
            }

            try {
                const result = JSON.parse(stdout);
                if (result.error) {
                    console.warn('NER script error:', result.error);
                    resolve({ entities: [] });
                } else {
                    resolve(result);
                }
            } catch (_parseError) {
                console.warn('Failed to parse NER output, using fallback');
                resolve({ entities: [] });
            }
        });

        // Send input to the script
        const input = JSON.stringify({ text, known_names: knownNames });
        pythonProcess.stdin.write(input);
        pythonProcess.stdin.end();

        // Timeout after 10 seconds
        setTimeout(() => {
            pythonProcess.kill();
            resolve({ entities: [] });
        }, 10000);
    });
}

/**
 * Replace detected person names with UIN placeholders
 */
function replacePersonEntities(text: string, entities: NEREntity[]): string {
    // Sort entities by start position in reverse order to maintain positions
    const sortedEntities = [...entities].sort((a, b) => b.start - a.start);

    let result = text;
    for (const entity of sortedEntities) {
        const replacement = entity.uin
            ? `[UIN:${entity.uin}]`
            : '[REDACTED]';

        result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
    }

    return result;
}

/**
 * Anonymize report content middleware
 * - Strips @[Name](UIN) markups to [UIN:XXXXXXXXXX]
 * - Uses spaCy NER to detect PERSON entities
 * - Replaces detected names with UINs or [REDACTED]
 */
export async function anonymizeReportContent(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { content, organization_id } = req.body;

        if (!content || typeof content !== 'string') {
            next();
            return;
        }

        // Step 1: Strip @mention markups
        const { text: mentionStrippedText, mentionedUins } = stripMentionMarkups(content);

        // Step 2: Fetch known names from organization's directory
        const knownNames = organization_id
            ? await fetchKnownNames(organization_id)
            : [];

        // Step 3: Run NER to detect other person names
        const nerResult = await runNERExtraction(mentionStrippedText, knownNames);

        // Step 4: Replace detected person entities
        let anonymizedContent = mentionStrippedText;
        if (nerResult.entities && nerResult.entities.length > 0) {
            anonymizedContent = replacePersonEntities(mentionStrippedText, nerResult.entities);
        }

        // Update request body with anonymized content
        req.body.content = anonymizedContent;
        req.body._mentionedUins = mentionedUins; // Store for reference

        next();
    } catch (error) {
        console.error('Anonymization error:', error);
        // Continue without anonymization on error (log but don't block)
        next();
    }
}

/**
 * Utility function to anonymize text (for direct use without middleware)
 */
export async function anonymizeText(
    content: string,
    organizationId?: string
): Promise<string> {
    // Step 1: Strip @mention markups
    const { text: mentionStrippedText } = stripMentionMarkups(content);

    // Step 2: Fetch known names
    const knownNames = organizationId
        ? await fetchKnownNames(organizationId)
        : [];

    // Step 3: Run NER
    const nerResult = await runNERExtraction(mentionStrippedText, knownNames);

    // Step 4: Replace entities
    let anonymizedContent = mentionStrippedText;
    if (nerResult.entities && nerResult.entities.length > 0) {
        anonymizedContent = replacePersonEntities(mentionStrippedText, nerResult.entities);
    }

    return anonymizedContent;
}

export default anonymizeReportContent;
