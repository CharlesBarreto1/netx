module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Resolve workspace alias @netx/shared no Metro
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@netx/shared': '../../packages/shared/src/index.ts',
          },
        },
      ],
      // WatermelonDB requer plugin de decorators legacy
      [
        '@babel/plugin-proposal-decorators',
        { legacy: true },
      ],
      'react-native-reanimated/plugin', // sempre por último
    ],
  };
};
