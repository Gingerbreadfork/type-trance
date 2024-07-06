const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Settings
const SETTINGS = {
  text: "default text for testing...",
  resolution: "1080x1920",
  textColor: "white",
  backgroundColor: "black",
  backgroundImage: false,
  videoLength: 3, // in seconds
  bufferTime: 0, // in seconds
  outputFileName: "output3.mp4",
  margins: { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 }, // Optional, these are the defaults
  flowFromTop: true, // Set to true to make text flow from top, false to keep it centred
  highlightText: true, // Enable text highlighting
  highlightOpacity: 0.7 // Adjust opacity as needed (0.0 to 1.0)
};

// Create a multi-bar container
const multibar = new cliProgress.MultiBar({
  clearOnComplete: false,
  hideCursor: true,
  format: ' {bar} | {percentage}% | {value}/{total} | {task}',
}, cliProgress.Presets.shades_classic);

function createProgressBar(total, task) {
  return multibar.create(total, 0, { task });
}

function wrapText(ctx, text, maxWidth) {
  let words = text.split(' ');
  let lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    let word = words[i];
    let width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

function optimizeLayout(ctx, text, maxWidth, maxHeight, minFontSize = 12, maxFontSize = 100) {
  let fontSize = maxFontSize;
  let lines;
  let lineHeight;

  while (fontSize >= minFontSize) {
    ctx.font = `${fontSize}px Arial`;
    lines = wrapText(ctx, text, maxWidth);
    lineHeight = fontSize * 1.2;
    let totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { fontSize, lines, lineHeight };
    }

    fontSize--;
  }

  ctx.font = `${minFontSize}px Arial`;
  lines = wrapText(ctx, text, maxWidth);
  lineHeight = minFontSize * 1.2;
  return { fontSize: minFontSize, lines, lineHeight };
}

async function generateTypingVideo(options) {
  const {
    text,
    resolution,
    textColor,
    backgroundColor,
    backgroundImage,
    videoLength,
    bufferTime,
    outputFileName,
    margins,
    flowFromTop,
    highlightText,
    highlightOpacity
  } = options;

  console.log("Initializing video generation...");

  const [width, height] = resolution.split('x').map(Number);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fps = 30;
  const totalFrames = videoLength * fps;
  const bufferFrames = bufferTime * fps;
  const typingFrames = totalFrames - 2 * bufferFrames;

  const tempDir = path.join(os.tmpdir(), 'temp_frames');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
    console.log("Created temporary directory for frames.");
  }

  let bgImageCanvas;
  if (backgroundImage) {
    console.log("Loading and caching background image...");
    const bgImage = await loadImage(backgroundImage);
    bgImageCanvas = createCanvas(width, height);
    const bgCtx = bgImageCanvas.getContext('2d');
    bgCtx.drawImage(bgImage, 0, 0, width, height);
    console.log("Background image cached successfully.");
  }

  const maxWidth = width * (1 - margins.left - margins.right);
  const maxHeight = height * (1 - margins.top - margins.bottom);

  console.log("Optimizing text layout...");
  const { fontSize, lines, lineHeight } = optimizeLayout(ctx, text, maxWidth, maxHeight);
  console.log(`Optimal font size: ${fontSize}px`);
  console.log(`Number of lines: ${lines.length}`);

  console.log("Generating frames...");

  // Create and start frame generation progress bar
  const frameGenBar = createProgressBar(totalFrames, "Generating Frames");

  for (let i = 0; i < totalFrames; i++) {
    if (bgImageCanvas) {
      ctx.drawImage(bgImageCanvas, 0, 0);
    } else {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    let displayLines = [];
    if (i >= bufferFrames && i < totalFrames - bufferFrames) {
      const progress = (i - bufferFrames) / typingFrames;
      const totalChars = text.length;
      const visibleChars = Math.floor(totalChars * progress);
      let charCount = 0;

      for (let line of lines) {
        if (charCount + line.length <= visibleChars) {
          displayLines.push(line);
          charCount += line.length;
        } else {
          displayLines.push(line.slice(0, visibleChars - charCount));
          break;
        }
      }
    } else if (i >= totalFrames - bufferFrames) {
      displayLines = lines;
    }

    let startY;
    if (flowFromTop) {
      startY = height * margins.top;
    } else {
      startY = (height - displayLines.length * lineHeight) / 2;
    }

    displayLines.forEach((line, index) => {
      const x = width * margins.left;
      const y = startY + index * lineHeight;
      const padding = 5; // Padding around the text to prevent overlap

      if (highlightText) {
        const metrics = ctx.measureText(line);
        const lineWidth = metrics.width;

        ctx.fillStyle = `rgba(0, 0, 0, ${highlightOpacity})`;
        ctx.fillRect(x - padding, y - padding, lineWidth + 2 * padding, lineHeight);
      }

      ctx.fillStyle = textColor;
      ctx.fillText(line, x, y);
    });

    const frameFileName = path.join(tempDir, `frame_${i.toString().padStart(5, '0')}.png`);
    fs.writeFileSync(frameFileName, canvas.toBuffer());

    // Update the progress bar
    frameGenBar.increment();
    // Force immediate logging update
    multibar.update();
  }

  frameGenBar.stop();
  console.log("\nFrames generated successfully. Starting video compilation...");

  // Create and start video compilation progress bar
  const videoCompBar = createProgressBar(totalFrames, "Compiling Video");

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(tempDir, 'frame_%05d.png'))
      .inputFPS(fps)
      .outputOptions('-c:v libx264')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions(`-r ${fps}`)
      .output(outputFileName)
      .on('progress', (progress) => {
        videoCompBar.update(progress.frames);
        // Force immediate logging update
        multibar.update();
      })
      .on('end', () => {
        videoCompBar.stop();
        console.log("\nVideo compilation completed. Cleaning up...");

        // Create and start cleanup progress bar
        const totalFiles = fs.readdirSync(tempDir).length;
        const cleanupBar = createProgressBar(totalFiles, "Cleaning Up");

        let filesDeleted = 0;
        fs.readdirSync(tempDir).forEach(file => {
          fs.unlinkSync(path.join(tempDir, file));
          filesDeleted++;
          cleanupBar.update(filesDeleted);
          // Force immediate logging update
          multibar.update();
        });
        fs.rmdirSync(tempDir);
        cleanupBar.update(totalFiles);
        cleanupBar.stop();
        multibar.stop();
        console.log("\nCleanup completed. Video generation finished successfully!");
        resolve();
      })
      .on('error', (err) => {
        console.error("Error during video compilation:", err);
        reject(err);
      })
      .run();
  });
}

generateTypingVideo(SETTINGS)
  .then(() => console.log("Video generation process completed."))
  .catch((err) => console.error("Error in video generation process:", err));
