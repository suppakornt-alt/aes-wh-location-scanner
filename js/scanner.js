/* Reusable camera barcode scanner. No page-specific UI or HUD logic. */
(function (global) {
  const DEFAULT_FORMATS = () => [
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.QR_CODE,
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF
  ];

  async function openCamera() {
    const attempts = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false }
    ];
    let lastError;
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) { lastError = error; }
    }
    throw lastError;
  }

  function BarcodeScanner(options = {}) {
    const video = options.video;
    const intervalMs = options.intervalMs ?? 100;
    const requiredMatches = options.requiredMatches ?? 5;
    const pattern = options.pattern || null;
    const onConfirmed = options.onConfirmed || (() => {});
    const onDetection = options.onDetection || (() => {});
    const onError = options.onError || (() => {});
    const onStateChange = options.onStateChange || (() => {});

    let stream = null;
    let timerId = null;
    let running = false;
    let lastCode = null;
    let matchCount = 0;

    const resetConfirmation = () => {
      lastCode = null;
      matchCount = 0;
    };

    const report = (code, format) => {
      const cleanCode = String(code ?? '').trim();
      if (!cleanCode || (pattern && !pattern.test(cleanCode))) return;

      if (cleanCode === lastCode) matchCount += 1;
      else {
        lastCode = cleanCode;
        matchCount = 1;
      }

      onDetection({ code: cleanCode, format, count: matchCount, required: requiredMatches });
      if (matchCount >= requiredMatches) {
        const confirmed = { code: cleanCode, format };
        resetConfirmation();
        onConfirmed(confirmed);
      }
    };

    const stop = () => {
      running = false;
      if (timerId) clearTimeout(timerId);
      timerId = null;
      resetConfirmation();
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      if (video) video.srcObject = null;
      onStateChange(false);
    };

    const start = async () => {
      stop();
      try {
        stream = await openCamera();
        if (!video) throw new Error('Scanner video element was not found');
        video.srcObject = stream;
        await video.play();
        running = true;
        onStateChange(true);

        if ('BarcodeDetector' in global) {
          const detector = new global.BarcodeDetector();
          const tick = async () => {
            if (!running) return;
            try {
              const results = await detector.detect(video);
              if (results.length) report(results[0].rawValue, results[0].format);
            } catch (_) {}
            if (running) timerId = setTimeout(tick, intervalMs);
          };
          tick();
        } else {
          const reader = new ZXing.MultiFormatReader();
          const hints = new Map();
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, options.formats || DEFAULT_FORMATS());
          hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
          reader.setHints(hints);
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { willReadFrequently: true });

          const tick = () => {
            if (!running) return;
            if (video.videoWidth > 0) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              try {
                const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
                const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
                const result = reader.decode(bitmap);
                report(result.getText(), ZXing.BarcodeFormat[result.getBarcodeFormat()]);
              } catch (_) {}
            }
            if (running) timerId = setTimeout(tick, intervalMs);
          };
          tick();
        }
      } catch (error) {
        stop();
        onError(error);
        throw error;
      }
    };

    return { start, stop, get running() { return running; } };
  }

  global.BarcodeScanner = BarcodeScanner;
})(window);
