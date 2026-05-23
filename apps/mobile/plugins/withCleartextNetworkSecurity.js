/**
 * Expo config plugin — força HTTP cleartext pro backend NetX (IP literal sem TLS).
 *
 * Por que não basta `usesCleartextTraffic: true` no manifest?
 *   Android 9+ tem Network Security Config padrão que pode sobrescrever a
 *   flag global. Pra IP literal (sem domínio), o Android é mais paranoico
 *   ainda. Garantia mais forte: nosso próprio NSC permitindo o IP.
 *
 * O que esse plugin faz:
 *   1. Copia network_security_config.xml pra android/app/src/main/res/xml/
 *   2. Adiciona `android:networkSecurityConfig="@xml/network_security_config"`
 *      no <application> do AndroidManifest.xml.
 *
 * Remover quando a VPS tiver TLS (Let's Encrypt + domínio).
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const XML_FILENAME = 'network_security_config.xml';

const withCopyNetworkSecurityConfig = (config) => {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcXml = path.join(cfg.modRequest.projectRoot, XML_FILENAME);
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
      );
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcXml, path.join(destDir, XML_FILENAME));
      return cfg;
    },
  ]);
};

const withManifestReference = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app.$ = app.$ || {};
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};

module.exports = (config) => withManifestReference(withCopyNetworkSecurityConfig(config));
