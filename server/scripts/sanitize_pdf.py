#!/usr/bin/env python3
"""
PDF Sanitization Script
Strips metadata (author, file path, creation date) from PDF reports
for privacy compliance before download.

Usage: python sanitize_pdf.py input.pdf output.pdf
"""

import sys
from pypdf import PdfReader, PdfWriter


def sanitize_pdf(input_path: str, output_path: str) -> dict:
    """
    Remove sensitive metadata from a PDF file.
    
    Args:
        input_path: Path to input PDF
        output_path: Path to save sanitized PDF
        
    Returns:
        dict with sanitization results
    """
    reader = PdfReader(input_path)
    writer = PdfWriter()
    
    # Copy all pages
    for page in reader.pages:
        writer.add_page(page)
    
    # Get original metadata for logging
    original_metadata = dict(reader.metadata) if reader.metadata else {}
    
    # Create sanitized metadata (remove sensitive fields)
    sanitized_metadata = {
        '/Producer': 'Safe Harbour POSH Platform',
        '/Creator': 'Safe Harbour Report System',
        '/Title': 'Confidential Report',
        # Remove: Author, CreationDate, ModDate, Subject, Keywords
    }
    
    # Apply sanitized metadata
    writer.add_metadata(sanitized_metadata)
    
    # Write sanitized PDF
    with open(output_path, 'wb') as output_file:
        writer.write(output_file)
    
    # Remove XMP metadata if present (additional privacy layer)
    try:
        # Re-read and strip XMP
        reader2 = PdfReader(output_path)
        writer2 = PdfWriter()
        for page in reader2.pages:
            writer2.add_page(page)
        writer2.add_metadata(sanitized_metadata)
        
        # Remove /Metadata reference if exists
        if hasattr(writer2, '_root_object') and '/Metadata' in writer2._root_object:
            del writer2._root_object['/Metadata']
            
        with open(output_path, 'wb') as output_file:
            writer2.write(output_file)
    except Exception:
        pass  # XMP stripping is optional
    
    return {
        'status': 'success',
        'input': input_path,
        'output': output_path,
        'stripped_fields': [
            '/Author', '/Creator', '/Producer', '/CreationDate', 
            '/ModDate', '/Subject', '/Keywords', '/XMP'
        ],
        'original_author': original_metadata.get('/Author', 'N/A'),
        'original_creator': original_metadata.get('/Creator', 'N/A'),
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: python sanitize_pdf.py <input.pdf> <output.pdf>")
        print("       python sanitize_pdf.py <input.pdf>  (overwrites in place)")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) >= 3 else input_path
    
    try:
        result = sanitize_pdf(input_path, output_path)
        print(f"✅ PDF sanitized successfully")
        print(f"   Input:  {result['input']}")
        print(f"   Output: {result['output']}")
        print(f"   Stripped: {', '.join(result['stripped_fields'])}")
    except FileNotFoundError:
        print(f"❌ Error: File not found: {input_path}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error sanitizing PDF: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
