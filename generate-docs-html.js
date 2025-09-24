#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the markdown documentation
const docsPath = path.join(__dirname, 'TYPED_FETCH_DOCUMENTATION.md');
const markdownContent = fs.readFileSync(docsPath, 'utf8');

// Generate simple HTML content
const htmlContent = `<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${markdownContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`;

// Write the HTML file to public directory
const outputPath = path.join(__dirname, 'public', 'index.html');
fs.writeFileSync(outputPath, htmlContent, 'utf8');

console.log('✅ Generated public/index.html successfully!');
console.log(`📄 File location: ${outputPath}`);