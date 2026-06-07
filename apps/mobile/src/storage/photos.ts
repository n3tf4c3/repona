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
