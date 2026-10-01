// apple_transcribe: transcribe an English audio file with Apple's on-device SpeechTranscriber (macOS 26+).
// Usage: apple_transcribe <audio file>   → JSON {"duration": s, "segments": [{"start","end","text"}]} on stdout,
// progress lines ("progress <seconds>") on stderr.
import AVFoundation
import Foundation
import Speech

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(("error " + message + "\n").data(using: .utf8)!)
    exit(1)
}

@main
struct AppleTranscribe {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 2 else { fail("usage: apple_transcribe <audio file>") }
        do {
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))
            let duration = Double(file.length) / file.processingFormat.sampleRate
            FileHandle.standardError.write("duration \(Int(duration))\n".data(using: .utf8)!)
            guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US")) else {
                fail("English speech model is not supported on this Mac")
            }
            let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                                reportingOptions: [], attributeOptions: [.audioTimeRange])
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                FileHandle.standardError.write("installing English speech model\n".data(using: .utf8)!)
                try await request.downloadAndInstall()
            }
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            let collector = Task { () throws -> [[String: Any]] in
                var segments: [[String: Any]] = []
                for try await result in transcriber.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if text.isEmpty { continue }
                    let start = result.range.start.seconds, end = result.range.end.seconds
                    segments.append(["start": (start * 100).rounded() / 100, "end": (end * 100).rounded() / 100, "text": text])
                    FileHandle.standardError.write("progress \(Int(end))\n".data(using: .utf8)!)
                }
                return segments
            }
            if let last = try await analyzer.analyzeSequence(from: file) {
                try await analyzer.finalizeAndFinish(through: last)
            } else {
                await analyzer.cancelAndFinishNow()
            }
            let segments = try await collector.value
            let json = try JSONSerialization.data(withJSONObject: ["duration": duration, "segments": segments])
            FileHandle.standardOutput.write(json)
        } catch {
            fail(String(describing: error))
        }
    }
}
