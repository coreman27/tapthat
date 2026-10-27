#!/usr/bin/env swift
// The App Store product-page header (21:9) and search-results image (3:2): three game screens on the app's dark
// background with the logo and one line. On a phone the product page shows only the middle of the header (about 60%
// of its width), so the 21:9 header keeps everything between 0.19 W and 0.81 W; the 3:2 search card shows the whole
// image, so that one uses the full width. Same layout as Tableside's scripts/appstore-marketing.swift.
//
//   swift scripts/appstore-marketing.swift <out.png> <width> <height> <left.png> <centre.png> <right.png>
//
// Called by scripts/appstore-marketing.sh with the raw screens from `node scripts/store-screenshots.js --marketing`.
// No alpha in the output (Apple refuses it).
import AppKit
import ImageIO

/// Apple refuses images with an alpha channel, so the drawing is copied onto an opaque RGB bitmap before encoding.
func writeOpaquePNG(_ rep: NSBitmapImageRep, to url: URL) {
    guard let source = rep.cgImage,
          let ctx = CGContext(data: nil, width: rep.pixelsWide, height: rep.pixelsHigh, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
    ctx.setFillColor(CGColor(gray: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: rep.pixelsWide, height: rep.pixelsHigh))
    ctx.draw(source, in: CGRect(x: 0, y: 0, width: rep.pixelsWide, height: rep.pixelsHigh))
    guard let flat = ctx.makeImage(), let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { exit(1) }
    CGImageDestinationAddImage(dest, flat, nil)
    guard CGImageDestinationFinalize(dest) else { exit(1) }
}

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

let args = CommandLine.arguments
guard args.count >= 7, let width = Int(args[2]), let height = Int(args[3]) else {
    FileHandle.standardError.write("usage: appstore-marketing.swift out.png width height left.png centre.png right.png\n".data(using: .utf8)!)
    exit(2)
}
let outURL = URL(fileURLWithPath: args[1])
let screens: [NSImage] = args[4...6].compactMap { NSImage(contentsOf: URL(fileURLWithPath: $0)) }
guard screens.count == 3 else { FileHandle.standardError.write("cannot read the three screens\n".data(using: .utf8)!); exit(1) }

let W = CGFloat(width), H = CGFloat(height)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = context
context.cgContext.setShouldAntialias(true)
context.cgContext.interpolationQuality = .high

/// The header is cropped to its middle on a phone; the search image is shown whole.
let tight = W / H > 2

// Background: the game's near-black (--bg) with its two glows, blue behind the logo and teal behind the phones.
let bounds = NSRect(x: 0, y: 0, width: W, height: H)
rgb(0x0a0b0f).setFill(); bounds.fill()
func glow(_ color: NSColor, x: CGFloat, y: CGFloat, radius: CGFloat) {
    NSGradient(colors: [color, color.withAlphaComponent(0)])!
        .draw(fromCenter: NSPoint(x: x, y: y), radius: 0, toCenter: NSPoint(x: x, y: y), radius: radius, options: [])
}
glow(rgb(0x1d3a8a, 0.75), x: W * (tight ? 0.24 : 0.12), y: H * 0.62, radius: W * (tight ? 0.30 : 0.42))
glow(rgb(0x0f4c4c, 0.55), x: W * (tight ? 0.72 : 0.80), y: H * 0.22, radius: W * (tight ? 0.28 : 0.38))

// Three phones on the right: the DON'T round largest and in front, a colour round and a new best behind it.
let screenAspect = screens[1].size.width / screens[1].size.height
let centreWidth = W * (tight ? 0.145 : 0.20)
let centreHeight = centreWidth / screenAspect
let sideWidth = centreWidth * 0.84, sideHeight = sideWidth / screenAspect
let groupCentreX = W * (tight ? 0.645 : 0.72)
let spread = centreWidth * 0.78
let corner = centreWidth * 0.11
let centreTop = max(H * 0.12, (H - centreHeight) / 2)
let sideTop = centreTop + (centreHeight - sideHeight) * 0.45

// The game's screens are as dark as the background, so each one sits in a titanium frame with a Dynamic Island
// (the captures leave the status-bar band empty) to read as a phone.
func drawScreen(_ image: NSImage, centreX: CGFloat, width: CGFloat, height: CGFloat, top: CGFloat) {
    let rect = NSRect(x: centreX - width / 2, y: H - top - height, width: width, height: height)
    let radius = corner * width / centreWidth
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    let bezel = width * 0.032, rim = width * 0.008
    let frameRect = rect.insetBy(dx: -bezel, dy: -bezel)
    let frame = NSBezierPath(roundedRect: frameRect, xRadius: radius + bezel, yRadius: radius + bezel)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowBlurRadius = W * 0.024; shadow.shadowOffset = NSSize(width: 0, height: -W * 0.007)
    shadow.shadowColor = NSColor(white: 0, alpha: 0.85); shadow.set()
    rgb(0x2a2e37).setFill(); frame.fill()
    NSGraphicsContext.restoreGraphicsState()
    // Brushed edge: light at the top-left, dark at the bottom-right, then the black glass border inside it.
    NSGradient(colors: [rgb(0x8a909c), rgb(0x3a3f49), rgb(0x23262d), rgb(0x5a606b)])!.draw(in: frame, angle: -55)
    let glassRect = frameRect.insetBy(dx: rim, dy: rim)
    NSColor.black.setFill()
    NSBezierPath(roundedRect: glassRect, xRadius: radius + bezel - rim, yRadius: radius + bezel - rim).fill()
    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    image.draw(in: rect, from: NSRect(origin: .zero, size: image.size), operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    let islandWidth = width * 0.29, islandHeight = width * 0.085
    let island = NSRect(x: rect.midX - islandWidth / 2, y: rect.maxY - width * 0.03 - islandHeight, width: islandWidth, height: islandHeight)
    NSColor.black.setFill()
    NSBezierPath(roundedRect: island, xRadius: islandHeight / 2, yRadius: islandHeight / 2).fill()
    NSColor(white: 1, alpha: 0.22).setStroke(); frame.lineWidth = W * 0.0008; frame.stroke()
}
drawScreen(screens[0], centreX: groupCentreX - spread, width: sideWidth, height: sideHeight, top: sideTop)
drawScreen(screens[2], centreX: groupCentreX + spread, width: sideWidth, height: sideHeight, top: sideTop)
drawScreen(screens[1], centreX: groupCentreX, width: centreWidth, height: centreHeight, top: centreTop)

// The logo as the home screen sets it ("Don't" white, "Tap That" in --link blue), then the line, vertically centred
// on the left inside the middle band of the image.
let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .left; paragraph.lineBreakMode = .byWordWrapping
paragraph.lineHeightMultiple = 0.88
let nameSize = W * (tight ? 0.05 : 0.064), lineSize = W * (tight ? 0.0175 : 0.021)
let nameFont = NSFont.systemFont(ofSize: nameSize, weight: .heavy)
let name = NSMutableAttributedString(string: "Don’t\n", attributes: [
    .font: nameFont, .foregroundColor: rgb(0xf5f6f8), .paragraphStyle: paragraph, .kern: -nameSize * 0.035,
])
name.append(NSAttributedString(string: "Tap That", attributes: [
    .font: nameFont, .foregroundColor: rgb(0x5aa9ff), .paragraphStyle: paragraph, .kern: -nameSize * 0.035,
]))
let lineParagraph = NSMutableParagraphStyle(); lineParagraph.alignment = .left; lineParagraph.lineBreakMode = .byWordWrapping
let line = NSMutableAttributedString(string: "A reflex game that learns how to beat you. ", attributes: [
    .font: NSFont.systemFont(ofSize: lineSize, weight: .medium), .foregroundColor: rgb(0xf5f6f8, 0.78), .paragraphStyle: lineParagraph,
])
line.append(NSAttributedString(string: "How long can you last?", attributes: [
    .font: NSFont.systemFont(ofSize: lineSize, weight: .bold), .foregroundColor: rgb(0xf5f6f8), .paragraphStyle: lineParagraph,
]))
let textX = W * (tight ? 0.19 : 0.06), textWidth = W * (tight ? 0.255 : 0.40)
let nameBox = name.boundingRect(with: NSSize(width: textWidth, height: H), options: [.usesLineFragmentOrigin])
let lineBox = line.boundingRect(with: NSSize(width: textWidth, height: H), options: [.usesLineFragmentOrigin])
let gap = W * 0.013
let blockHeight = nameBox.height + gap + lineBox.height
var y = (H + blockHeight) / 2 - nameBox.height
name.draw(with: NSRect(x: textX, y: y, width: textWidth, height: nameBox.height), options: [.usesLineFragmentOrigin])
y -= gap + lineBox.height
line.draw(with: NSRect(x: textX, y: y, width: textWidth, height: lineBox.height), options: [.usesLineFragmentOrigin])

NSGraphicsContext.restoreGraphicsState()
writeOpaquePNG(rep, to: outURL)
print("wrote \(outURL.path) \(width)x\(height)")
