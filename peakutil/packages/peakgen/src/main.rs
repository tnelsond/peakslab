use indicatif::{ProgressBar, ProgressStyle};
use std::env;
use std::fs;
use std::io::{self, Cursor};
use std::path::Path;
use std::str;
use zstd::stream::encode_all;

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: peak-gen <input> <optional-flags> <output>");
        std::process::exit(1);
    }

    let input_path = Path::new(&args[1]);
		let noheader = if args.len() > 3 {true} else {false};
    let output_path = &args[args.len()-1];

    let mut data: Vec<u8> = Vec::new();
    let mut primary_offsets: Vec<u32> = Vec::new();
    let mut secondary_offsets: Vec<u32> = Vec::new();

    if input_path.is_dir() {
        // === SLAB MODE ===
        let entries: Vec<_> = fs::read_dir(input_path)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();

        let pb = ProgressBar::new(entries.len() as u64);
        pb.set_style(ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")
            .unwrap()
            .progress_chars("#>-"),
        );
        pb.set_message("Processing files");

        let mut filenames: Vec<String> = entries;
        filenames.sort_by(|a, b| peakcmp::cmp(a, b));

        for filename in filenames {
            let file_path = input_path.join(&filename);
            let content = fs::read(&file_path)?;

            let offset = data.len() as u32;
            primary_offsets.push(offset);

            data.extend_from_slice(filename.as_bytes());
            data.push(b'\t');
            data.extend_from_slice(&content);

            pb.inc(1);
        }
        pb.finish_with_message("Files processed");
    } else {
        // === PEAK MODE ===
        let content = fs::read_to_string(input_path)?;
        let lines: Vec<String> = content.lines().map(String::from).collect();

        let pb = ProgressBar::new(lines.len() as u64);
        pb.set_style(ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) Sorting & writing")
            .unwrap()
            .progress_chars("#>-"),
        );

        let mut sorted_lines = lines;
        sorted_lines.sort_by(|a, b| peakcmp::cmp(a, b));

        for line in sorted_lines {
            let start_offset = data.len() as u32;
            primary_offsets.push(start_offset);

            for c in line.chars() {
                if c == '@' {
                    secondary_offsets.push(data.len() as u32);
                } else {
                    let mut buf = [0u8; 4];
                    data.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
            }
						if noheader{
							data.push(b'\n'); // This is optional, but it makes it way easier to read the files with a text editor.
						}
            pb.inc(1);
        }
        pb.finish_with_message("Lines processed");

        // === FIXED: Efficient secondary index sorting ===
        if !secondary_offsets.is_empty() {
            println!("Sorting {} secondary offsets...", secondary_offsets.len());
            
            // Precompute strings for each offset (up to next entry or \n)
            let pb_prep = ProgressBar::new(secondary_offsets.len() as u64);
            pb_prep.set_message("Extracting strings for sorting");
            
            let mut offset_strings: Vec<(u32, String)> = Vec::with_capacity(secondary_offsets.len());
            
            for &offset in &secondary_offsets {
                let start = offset as usize;
                let end = data[start..].iter().position(|&b| b == b'\n' || b == b'\t').unwrap_or(data.len() - start);
                let entry_bytes = &data[start..start + end];
                let entry_str = str::from_utf8(entry_bytes).unwrap_or("").to_string();
                offset_strings.push((offset, entry_str));
                pb_prep.inc(1);
            }
            pb_prep.finish_with_message("Strings extracted");

            // Sort by string content (stable, efficient)
            let pb_sort = ProgressBar::new(offset_strings.len() as u64);
            pb_sort.set_style(ProgressStyle::default_spinner());
            pb_sort.set_message("Sorting secondary index");

            offset_strings.sort_by(|(_, sa), (_, sb)| peakcmp::cmp(sa, sb));
            
            // Extract sorted offsets
            secondary_offsets.clear();
            secondary_offsets.extend(offset_strings.iter().map(|(off, _)| *off));
            
            pb_sort.finish_with_message("Secondary index sorted");
        }
    }

    // === Build header ===
    let mut header: Vec<u8> = Vec::new();
    let num_indexes = if secondary_offsets.is_empty() { 1 } else { 2 };
    header.extend_from_slice(&(num_indexes as u32).to_le_bytes());

    header.extend_from_slice(&(primary_offsets.len() as u32).to_le_bytes());
    for &off in &primary_offsets {
        header.extend_from_slice(&off.to_le_bytes());
    }

    if num_indexes == 2 {
        header.extend_from_slice(&(secondary_offsets.len() as u32).to_le_bytes());
        for &off in &secondary_offsets {
            header.extend_from_slice(&off.to_le_bytes());
        }
    }

    let mut binary: Vec<u8> = if !noheader {header} else {Vec::new()};
    binary.extend_from_slice(&data);
    let uncompressed_size = binary.len();

    println!("generating, ({} bytes).", uncompressed_size);

    if output_path.ends_with(".zst") {
        let pb_compress = ProgressBar::new_spinner();
        pb_compress.enable_steady_tick(std::time::Duration::from_millis(80));
        pb_compress.set_message("Compressing zstd level 19");

        let compressed = encode_all(Cursor::new(&binary), 19)?;
        fs::write(output_path, &compressed)?;

        pb_compress.finish_and_clear();
        println!("compressing ({} bytes -> {} bytes)", uncompressed_size, compressed.len());
    } else {
        fs::write(output_path, &binary)?;
    }

    Ok(())
}
