/**
 * nfcom-signer — assinatura digital XMLDSig do <NFCom> (padrão DFe SEFAZ).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Extrai chave privada + certificado do .pfx (A1) com node-forge e assina o
 * elemento <infNFCom> por Id, inserindo <Signature> como último filho de
 * <NFCom> (ordem do XSD: infNFCom, infNFComSupl, Signature).
 *
 * Algoritmos DFe: C14N (xml-c14n-20010315) + SHA-1 + RSA-SHA1 + transform
 * enveloped. KeyInfo com X509Certificate (DER base64 do A1).
 */
import { SignedXml } from 'xml-crypto';
import forge from 'node-forge';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

interface PfxMaterial {
  privateKeyPem: string;
  certPem: string;
  certDerBase64: string;
}

/** Extrai a chave privada e o certificado de um .pfx (PKCS#12). */
export function extractPfx(pfx: Buffer, passphrase: string): PfxMaterial {
  const p12Asn1 = forge.asn1.fromDer(pfx.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

  // Chave privada — pode estar como pkcs8ShroudedKeyBag ou keyBag.
  let keyObj: forge.pki.PrivateKey | undefined;
  for (const oid of [
    forge.pki.oids.pkcs8ShroudedKeyBag,
    forge.pki.oids.keyBag,
  ]) {
    const bags = p12.getBags({ bagType: oid })[oid] ?? [];
    const withKey = bags.find((b) => b.key);
    if (withKey?.key) {
      keyObj = withKey.key;
      break;
    }
  }
  if (!keyObj) throw new Error('Chave privada não encontrada no .pfx');

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ] ?? [];
  const certBag = certBags.find((b) => b.cert);
  if (!certBag?.cert) throw new Error('Certificado não encontrado no .pfx');

  const certPem = forge.pki.certificateToPem(certBag.cert);
  const derBytes = forge.asn1
    .toDer(forge.pki.certificateToAsn1(certBag.cert))
    .getBytes();
  const certDerBase64 = forge.util.encode64(derBytes);

  return {
    privateKeyPem: forge.pki.privateKeyToPem(
      keyObj as forge.pki.rsa.PrivateKey,
    ),
    certPem,
    certDerBase64,
  };
}

/**
 * Assina o XML do <NFCom>. Referência = #NFCom{chave} (Id do infNFCom).
 * Retorna o XML com <Signature> anexado.
 */
export function signNfcomXml(
  xml: string,
  pfx: Buffer,
  passphrase: string,
): string {
  const mat = extractPfx(pfx, passphrase);

  const sig = new SignedXml({
    privateKey: mat.privateKeyPem,
    publicCert: mat.certPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infNFCom']",
    digestAlgorithm: SHA1,
    transforms: [ENVELOPED, C14N],
  });

  // KeyInfo com o certificado (X509Certificate em DER base64).
  sig.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${mat.certDerBase64}</X509Certificate></X509Data>`;

  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='NFCom']", action: 'append' },
  });

  return sig.getSignedXml();
}
