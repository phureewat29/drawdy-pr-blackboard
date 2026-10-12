/**
 * tree-sitter-typescript 0.23.2 cannot insert a semicolon before a member
 * that starts with `<`, so a generic call signature after a member without
 * one (`get: Get` then `<K>(key: K): V`) breaks the whole interface, and in
 * code written without semicolons the error can swallow the file. Puts a `;`
 * in the indentation before such a line: offsets and lines stay the same, and
 * the flat tree keeps the original text.
 */
export const repairCallSignatures = (text: string): string => {
    if (!/\n[ \t]+<([A-Za-z_$]|[ \t]*\r?\n)/.test(text)) return text;
    const lines = text.split("\n");
    let previous = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // `<T extends ...>(`, `<T, U>(`, or `<` alone with the type parameters on the next lines.
        const m = /^([ \t]*)[ \t]<(\s*$|[A-Za-z_$][\w$]*\s*(extends\b|,|=|>))/.exec(line);
        if (m && previous && !/[;{(,[=|&:]\s*$|=>\s*$/.test(previous)) lines[i] = `${m[1]};${line.slice(m[1].length + 1)}`;
        if (line.trim() !== "") previous = line;
    }
    return lines.join("\n");
};
