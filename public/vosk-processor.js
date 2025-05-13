class VoskProcessor extends AudioWorkletProcessor {
  // Buffer to accumulate audio data
  _buffer = [];
  _bufferSize = 2048; // Adjust as needed, but keep it reasonable

  constructor(options) {
    super(options);
    if (options && options.processorOptions && options.processorOptions.bufferSize) {
      this._bufferSize = options.processorOptions.bufferSize;
    }
    // console.log('[VoskProcessor] Constructed with buffer size:', this._bufferSize);
  }

  // data is a Float32Array containing PCM data for each channel.
  // Vosk typically wants mono 16kHz 16-bit PCM.
  // The input from the browser is usually 32-bit float, stereo or mono, at the AudioContext's sampleRate.
  process(inputs, outputs, parameters) {
    // We expect one input, and that input to have one channel (mono).
    // If it's stereo, we might just take the first channel.
    const input = inputs[0];
    if (!input || !input[0]) {
      // console.log('[VoskProcessor] No input data');
      return true; // Keep processor alive
    }

    // Assuming mono input for simplicity, or taking the first channel if stereo.
    const channelData = input[0]; 

    // Accumulate data in our buffer
    this._buffer.push(...channelData);

    // When buffer has enough data, post it
    // This logic assumes that the buffer fills up relatively quickly.
    // A more robust solution might involve checking the actual sample rate and desired chunk size for Vosk.
    // For now, let's just post whatever we have if it exceeds a threshold, or post fixed chunks.
    // Vosk can handle chunks of varying sizes, but consistent chunking is often good.
    
    // Post every _bufferSize samples. This is a simplification.
    // A more robust implementation would handle resampling to 16kHz if necessary
    // and convert to 16-bit PCM before posting, or let the main thread do it.
    // For now, let's post Float32Array and let main thread handle conversion to Int16Array if needed.
    // This is because converting to Int16Array in the worklet and then transferring it is not straightforward
    // due to ArrayBuffer transfer limitations with certain types directly.

    while (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.splice(0, this._bufferSize);
      // Post the Float32Array chunk. The main thread will need to convert this to Int16Array for Vosk.
      // Or, if Vosk library can handle Float32 directly after resampling, that's simpler.
      // Vosk KaldiRecognizer's acceptWaveform in some bindings expects Int16Array or a compatible buffer.
      // The vosk-browser example often uses ScriptProcessorNode which provides AudioBuffer. 
      // We are using AudioWorklet, so we get Float32Array.
      this.port.postMessage(new Float32Array(chunk));
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor("vosk-processor", VoskProcessor); 