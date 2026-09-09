// lyrics: offline speech-to-text -> .lrc using macOS on-device recognition. No install, no network.
// The audio is cut into chunks (silence-separated for speech, fixed 20 s windows for songs), each chunk is
// recognised separately and its word timestamps are offset back into song time.
// build: swiftc -O tools/lyrics.swift -o tools/Lyrics.app/Contents/MacOS/lyrics -framework Speech -framework AVFoundation
import Foundation
import Speech
import AVFoundation

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: lyrics <audio> [locale]\n", stderr); exit(1) }
let url = URL(fileURLWithPath: args[1])
let localeId = args.count > 2 ? args[2] : "en-US"
let outURL = url.deletingPathExtension().appendingPathExtension("lrc")
func fail(_ msg: String, _ code: Int32) -> Never { try? msg.write(to: url.deletingPathExtension().appendingPathExtension("lrc.error"), atomically: true, encoding: .utf8); fputs(msg + "\n", stderr); exit(code) }

DispatchQueue.global().async {
  let sem = DispatchSemaphore(value: 0); var authorized = false
  SFSpeechRecognizer.requestAuthorization { s in authorized = (s == .authorized); sem.signal() }; sem.wait()
  guard authorized else { fail("speech recognition not authorized", 2) }
  guard let rec = SFSpeechRecognizer(locale: Locale(identifier: localeId)), rec.isAvailable else { fail("recognizer unavailable for \(localeId)", 3) }

  // ---- read the audio as mono float ----
  guard let file = try? AVAudioFile(forReading: url) else { fail("cannot read audio", 4) }
  let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: file.fileFormat.sampleRate, channels: 1, interleaved: false)!
  let frames = AVAudioFrameCount(file.length)
  guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { fail("alloc", 4) }
  do {
    if file.processingFormat.channelCount == 1 && file.processingFormat.commonFormat == .pcmFormatFloat32 { try file.read(into: buf) }
    else {
      let tmp = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames)!; try file.read(into: tmp)
      let conv = AVAudioConverter(from: file.processingFormat, to: fmt)!; var err: NSError? = nil; var fed = false
      conv.convert(to: buf, error: &err) { _, status in if fed { status.pointee = .endOfStream; return nil }; fed = true; status.pointee = .haveData; return tmp }
      if let e = err { fail("convert: \(e)", 4) }
    }
  } catch { fail("read: \(error)", 4) }
  let sr = fmt.sampleRate, n = Int(buf.frameLength), x = buf.floatChannelData![0]
  let total = Double(n) / sr

  // ---- segmentation ----
  let win = Int(sr * 0.05); var rms: [Double] = []
  var i = 0; while i + win <= n { var s = 0.0; for j in i..<(i + win) { s += Double(x[j]*x[j]) }; rms.append(sqrt(s / Double(win))); i += win }
  let sorted = rms.sorted(); let noise = sorted[Int(Double(sorted.count) * 0.2)]; let thr = max(noise * 4.0, 0.01)
  var regions: [(Double, Double)] = []; var inSeg = false; var st = 0.0; var last = 0.0
  for (k, v) in rms.enumerated() { let t = Double(k) * 0.05
    if v > thr { if !inSeg { if let l = regions.last, t - l.1 < 1.0 { regions.removeLast(); st = l.0 } else { st = t }; inSeg = true }; last = t }
    else if inSeg && t - last > 0.8 { regions.append((max(0, st - 0.3), min(total, last + 0.4))); inSeg = false } }
  if inSeg { regions.append((max(0, st - 0.3), total)) }
  let covered = regions.reduce(0.0) { $0 + $1.1 - $1.0 }
  if regions.isEmpty || covered > 0.8 * total || regions.contains(where: { $1 - $0 > 45 }) {   // a song: fixed windows
    regions = []; var t = 0.0; while t < total { regions.append((t, min(total, t + 20.0))); t += 19.0 }
  }

  var log = "total \(total)s regions \(regions.count): \(regions.map { String(format: "%.1f-%.1f", $0.0, $0.1) }.joined(separator: " "))\n"
  // ---- recognise each chunk ----
  var lines: [(Double, String)] = []
  let tmpDir = FileManager.default.temporaryDirectory
  for (ri, r) in regions.enumerated() {
    let a = Int(r.0 * sr), b = min(n, Int(r.1 * sr)); if b - a < Int(sr * 0.4) { continue }
    let chunk = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(b - a))!
    chunk.frameLength = AVAudioFrameCount(b - a); memcpy(chunk.floatChannelData![0], x + a, (b - a) * 4)
    let curl = tmpDir.appendingPathComponent("lyrics-chunk-\(ri).wav")
    guard let out = try? AVAudioFile(forWriting: curl, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sr, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]) else { log += "chunk \(ri): cannot create wav\n"; continue }
    do { try out.write(from: chunk) } catch { log += "chunk \(ri): write failed \(error)\n"; continue }
    let req = SFSpeechURLRecognitionRequest(url: curl); req.shouldReportPartialResults = false
    req.requiresOnDeviceRecognition = rec.supportsOnDeviceRecognition
    let done = DispatchSemaphore(value: 0); var segs: [SFTranscriptionSegment] = []
    var errText = ""
    rec.recognitionTask(with: req) { result, error in
      if let res = result, res.isFinal { segs = res.bestTranscription.segments; done.signal() }
      else if let e = error { errText = e.localizedDescription; done.signal() } }
    _ = done.wait(timeout: .now() + 120)
    log += "chunk \(ri) [\(r.0)-\(r.1)]: \(segs.count) segments \(errText)\n"
    var cur: [String] = []; var start = 0.0; var lastEnd = 0.0
    for seg in segs {
      let ts = seg.timestamp + r.0
      if !cur.isEmpty && (ts - lastEnd > 0.7 || cur.count >= 7) { lines.append((start, cur.joined(separator: " "))); cur = [] }
      if cur.isEmpty { start = ts }
      cur.append(seg.substring); lastEnd = ts + seg.duration }
    if !cur.isEmpty { lines.append((start, cur.joined(separator: " "))) }
    try? FileManager.default.removeItem(at: curl)
  }
  var text = ""
  for (t, s) in lines.sorted(by: { $0.0 < $1.0 }) { let m = Int(t / 60); let sec = t - Double(m * 60); text += String(format: "[%02d:%05.2f]%@\n", m, sec, s) }
  try? text.write(to: outURL, atomically: true, encoding: .utf8)
  try? log.write(to: url.deletingPathExtension().appendingPathExtension("lrc.log"), atomically: true, encoding: .utf8)
  print(text); exit(0)
}
RunLoop.main.run()
