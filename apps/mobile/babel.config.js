module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo já inclui o transform de expo-router (require.context)
    // e o JSX runtime do React. Não sobrescrever opções aqui.
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB usa decorators legacy nos @model('table')
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // reanimated/plugin TEM que ser o último plugin da lista
      'react-native-reanimated/plugin',
    ],
  };
};
