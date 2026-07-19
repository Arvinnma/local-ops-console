import AppKit
import Foundation

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()
guard let context = NSGraphicsContext.current else { exit(1) }
context.imageInterpolation = .high

let canvas = NSRect(x: 32, y: 32, width: 960, height: 960)
let background = NSBezierPath(roundedRect: canvas, xRadius: 230, yRadius: 230)

context.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.4)
shadow.shadowBlurRadius = 48
shadow.shadowOffset = NSSize(width: 0, height: -20)
shadow.set()
NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.082, alpha: 1).setFill()
background.fill()
context.restoreGraphicsState()

let gradient = NSGradient(colors: [
  NSColor(calibratedRed: 0.08, green: 0.18, blue: 0.19, alpha: 1),
  NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.082, alpha: 1)
])!
gradient.draw(in: background, angle: -48)

NSColor(calibratedRed: 0.45, green: 0.91, blue: 0.72, alpha: 0.18).setStroke()
background.lineWidth = 5
background.stroke()

let ringRect = NSRect(x: 214, y: 214, width: 596, height: 596)
let ring = NSBezierPath(ovalIn: ringRect)
NSColor(calibratedRed: 0.45, green: 0.91, blue: 0.72, alpha: 0.09).setStroke()
ring.lineWidth = 4
ring.stroke()

let bars: [(CGFloat, CGFloat, CGFloat)] = [
  (320, 276, 190),
  (448, 276, 410),
  (576, 276, 292)
]

for (index, bar) in bars.enumerated() {
  let rect = NSRect(x: bar.0, y: bar.1, width: 94, height: bar.2)
  let path = NSBezierPath(roundedRect: rect, xRadius: 47, yRadius: 47)
  let alpha: CGFloat = index == 0 ? 0.55 : (index == 1 ? 1 : 0.78)
  NSColor(calibratedRed: 0.45, green: 0.91, blue: 0.72, alpha: alpha).setFill()
  path.fill()
}

let dot = NSBezierPath(ovalIn: NSRect(x: 689, y: 677, width: 54, height: 54))
NSColor(calibratedRed: 0.45, green: 0.91, blue: 0.72, alpha: 1).setFill()
dot.fill()

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let data = bitmap.representation(using: .png, properties: [:]) else {
  exit(1)
}

try data.write(to: URL(fileURLWithPath: output))
