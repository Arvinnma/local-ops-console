import AppKit
import Foundation

guard CommandLine.arguments.count >= 4,
      let pixelSize = Int(CommandLine.arguments[3]),
      pixelSize > 0 else {
  fputs("Usage: GenerateIcon.swift <source.svg> <output.png> <pixel-size>\n", stderr)
  exit(2)
}

let source = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
guard let vectorImage = NSImage(contentsOfFile: source),
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
      ) else {
  fputs("Unable to render SVG: \(source)\n", stderr)
  exit(1)
}

bitmap.size = NSSize(width: pixelSize, height: pixelSize)
guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize).fill()
vectorImage.draw(
  in: NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize),
  from: .zero,
  operation: .sourceOver,
  fraction: 1
)
graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let data = bitmap.representation(using: .png, properties: [.compressionFactor: 1]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: output))
