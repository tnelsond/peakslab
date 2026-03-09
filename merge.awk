BEGIN { FS = OFS = "\t" }
NR == 1 { prev = $1; line = $0; next }
{
    if ($1 == prev) {
        append = ""
        for (i = 3; i <= NF; i++) {
            if (append != "") append = append OFS
            append = append $i
        }
        if (append != "") {
            line = line OFS append
        }
    } else {
        print line
        prev = $1
        line = $0
    }
}
END { if (NR > 0) print line }
