import os
from khmernormalizer import KhmerNormalizer

# Directory containing your text files
input_directory = './'
output_directory = 'normalized/'

# Create an instance of KhmerNormalizer
normalizer = KhmerNormalizer()

# Ensure output directory exists
os.makedirs(output_directory, exist_ok=True)

# Iterate over files in the input directory
for filename in os.listdir(input_directory):
    if filename.endswith('.tsv'):
        input_path = os.path.join(input_directory, filename)
        output_path = os.path.join(output_directory, filename)

        with open(input_path, 'r', encoding='utf-8') as file:
            content = file.read()

        # Normalize the content
        normalized_content = normalizer.normalize(content)

        # Save the normalized content to a new file
        with open(output_path, 'w', encoding='utf-8') as file:
            file.write(normalized_content)

print("Normalization complete for all files.")

