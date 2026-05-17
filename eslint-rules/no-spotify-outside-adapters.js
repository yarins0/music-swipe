/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Prevents direct imports from src/adapters/spotify/ outside the adapter boundary',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const filename = context.filename ?? context.getFilename?.() ?? '';

        const importsSpotifyAdapter =
          source.includes('adapters/spotify') ||
          source.includes('adapters\\spotify');

        const isInsideAdapterDir =
          filename.includes('/src/adapters/') ||
          filename.includes('\\src\\adapters\\');

        // AuthGateway.ts is the sole authorized factory crossing the boundary
        const isAuthGateway =
          filename.includes('AuthGateway.ts');

        if (importsSpotifyAdapter && !isInsideAdapterDir && !isAuthGateway) {
          context.report({
            node,
            message:
              "Do not import from src/adapters/spotify/ outside src/adapters/ — use the MusicPlatformAdapter interface instead.",
          });
        }
      },
    };
  },
};
