#!/usr/bin/env python3
"""
Named Entity Recognition script using spaCy.
Reads JSON from stdin, extracts PERSON entities, returns JSON via stdout.

Input format:
{
    "text": "The text to analyze",
    "known_names": [{"name": "John Doe", "uin": "1234567890"}, ...]
}

Output format:
{
    "entities": [
        {"text": "John", "start": 10, "end": 14, "label": "PERSON", "uin": "1234567890"},
        {"text": "Jane", "start": 25, "end": 29, "label": "PERSON", "uin": null}
    ]
}
"""

import sys
import json

try:
    import spacy
except ImportError:
    print(json.dumps({
        "error": "spaCy not installed. Run: pip install spacy && python -m spacy download en_core_web_sm"
    }))
    sys.exit(1)

# Load the English NLP model
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print(json.dumps({
        "error": "spaCy model not found. Run: python -m spacy download en_core_web_sm"
    }))
    sys.exit(1)


def normalize_name(name: str) -> str:
    """Normalize name for comparison (lowercase, strip whitespace)."""
    return ' '.join(name.lower().strip().split())


def find_matching_uin(entity_text: str, known_names: list) -> str | None:
    """Find matching UIN for a detected entity from known names list."""
    normalized_entity = normalize_name(entity_text)
    
    for known in known_names:
        known_normalized = normalize_name(known.get('name', ''))
        
        # Check for exact match
        if normalized_entity == known_normalized:
            return known.get('uin')
        
        # Check for partial match (first name or last name)
        entity_parts = normalized_entity.split()
        known_parts = known_normalized.split()
        
        # If any part matches, consider it a match
        for entity_part in entity_parts:
            if entity_part in known_parts:
                return known.get('uin')
    
    return None


def extract_person_entities(text: str, known_names: list) -> list:
    """Extract PERSON entities from text using spaCy NER."""
    doc = nlp(text)
    
    entities = []
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            uin = find_matching_uin(ent.text, known_names)
            entities.append({
                "text": ent.text,
                "start": ent.start_char,
                "end": ent.end_char,
                "label": "PERSON",
                "uin": uin
            })
    
    return entities


def main():
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())
        
        text = input_data.get('text', '')
        known_names = input_data.get('known_names', [])
        
        # Extract entities
        entities = extract_person_entities(text, known_names)
        
        # Output result
        result = {"entities": entities}
        print(json.dumps(result))
        
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {str(e)}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Processing error: {str(e)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
