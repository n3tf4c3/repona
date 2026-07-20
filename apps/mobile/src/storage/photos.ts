import { Directory, File, Paths } from 'expo-file-system';

// Diretório persistente do app (não é limpo pelo sistema, ao contrário do cache).
const photosDir = new Directory(Paths.document, 'product-photos');

// Copia a foto recém-tirada (que fica no cache da câmera e pode ser apagada
// pelo sistema) para o diretório persistente do app, devolvendo a nova URI.
// Se a foto já estiver persistida — ou não houver foto — devolve como está.
export function persistPhoto(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith(photosDir.uri)) return uri;

  try {
    if (!photosDir.exists) photosDir.create({ idempotent: true });
    const source = new File(uri);
    const ext = source.extension || '.jpg';
    const dest = new File(photosDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    source.copy(dest);
    return dest.uri;
  } catch {
    // Se a cópia falhar, manter a URI original é melhor do que perder a foto.
    return uri;
  }
}

// Remove uma foto persistida no diretório do app. Best-effort e restrito ao
// photosDir: nunca apaga URIs de fora (câmera/galeria/legadas). Chamado quando o
// produto é excluído ou troca de foto, para o arquivo não ficar órfão crescendo
// o uso de disco indefinidamente. (auditoria #94)
export function deletePhoto(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith(photosDir.uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // best-effort: um arquivo que não pôde ser apagado não deve quebrar o fluxo.
  }
}
