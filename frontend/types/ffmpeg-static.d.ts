// ffmpeg-static non pubblica dichiarazioni di tipo proprie: esporta solo il
// path assoluto del binario ffmpeg per la piattaforma corrente (null se la
// piattaforma/architettura non è supportata). Vedi uso in
// app/api/concat-videos/route.ts.
declare module 'ffmpeg-static' {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
