// Bun resolves `with { type: 'file' }` imports to a readable path string, in
// development and in the compiled binary alike. These declarations give the
// embedded git assets a type for the TypeScript compiler.

declare module '*/gitconfig' {
  const filePath: string;
  export default filePath;
}

declare module '*/gitignore_global' {
  const filePath: string;
  export default filePath;
}
