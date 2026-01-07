const fs = require('fs');
const path = require('path');
const { split } = require('split-khmer');

// Get the input file path from command line arguments
const inputFilePath = process.argv[2];

if (!inputFilePath) {
    console.error('Please provide the path to the text file as an argument.');
    process.exit(1);
}

// Read the file content
fs.readFile(path.resolve(inputFilePath), 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading the file:', err);
        process.exit(1);
    }

    // Split the content into words using split-khmer
    const words = split(data);

    // Join the words with a zero-width space
    const invisibleSpace = '\u200B'; // Zero-width space character
    const output = words.join(invisibleSpace);
    
    // Output the result
    console.log(output);
});
