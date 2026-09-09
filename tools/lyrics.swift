// lyrics: offline speech-to-text -> .lrc, using macOS on-device recognition (no install, no network).
// build: swiftc -O tools/lyrics.swift -o tools/lyrics -framework Speech
// usage: tools/lyrics song.mp3 [en-US|zh-CN|ja-JP ...] > song.lrc
import Foundation
import Speech
let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: lyrics <audio file> [locale]\n", stderr); exit(1) }
let url = URL(fileURLWithPath: args[1])
let localeId = args.count > 2 ? args[2] : "en-US"
DispatchQueue.global().async {
let sem = DispatchSemaphore(value: 0)
var authorized = false
SFSpeechRecognizer.requestAuthorization { s in authorized = (s == .authorized); sem.signal() }
sem.wait()
guard authorized else { fputs("speech recognition not authorized (System Settings > Privacy > Speech Recognition)\n", stderr); exit(2) }
guard let rec = SFSpeechRecognizer(locale: Locale(identifier: localeId)), rec.isAvailable else { fputs("recognizer unavailable for \(localeId)\n", stderr); exit(3) }
let req = SFSpeechURLRecognitionRequest(url: url)
req.shouldReportPartialResults = false
req.requiresOnDeviceRecognition = rec.supportsOnDeviceRecognition
if #available(macOS 13.0, *) { req.addsPunctuation = false }
let done = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0
rec.recognitionTask(with: req) { result, error in
  if let e = error { fputs("error: \(e.localizedDescription)\n", stderr); exitCode = 4; done.signal(); return }
  guard let r = result, r.isFinal else { return }
  // group word segments into lines: break on pauses > 0.7 s or after 7 words
  var lines: [(Double, String)] = []
  var cur: [String] = []; var start = 0.0; var lastEnd = 0.0
  for seg in r.bestTranscription.segments {
    if !cur.isEmpty && (seg.timestamp - lastEnd > 0.7 || cur.count >= 7) { lines.append((start, cur.joined(separator: " "))); cur = [] }
    if cur.isEmpty { start = seg.timestamp }
    cur.append(seg.substring); lastEnd = seg.timestamp + seg.duration
  }
  if !cur.isEmpty { lines.append((start, cur.joined(separator: " "))) }
  for (t, s) in lines { let m = Int(t / 60); let sec = t - Double(m * 60); print(String(format: "[%02d:%05.2f]%@", m, sec, s)) }
  done.signal()
}
done.wait()
exit(exitCode)
}
RunLoop.main.run()
