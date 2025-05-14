"use client";

import { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateMLCEngine, MLCEngine, ChatCompletionChunk } from "@mlc-ai/web-llm";
import Vosk, {
    Model as VoskModel,
    KaldiRecognizer as VoskKaldiRecognizer
} from "vosk-browser";

// Define a model string - using a small, fast-loading model for initial setup
// You can find more models at https://mlc.ai/package/
// const SELECTED_MODEL = "Llama-3-8B-Instruct-q4f16_1-MLC"; // A general purpose Llama 3 model
// const SELECTED_MODEL = "gemma-2b-it-q4f16_1-MLC"; // A smaller Gemma model if Llama is too slow initially
const SELECTED_LLM_MODEL = "Phi-3-mini-4k-instruct-q4f16_1-MLC"; // A very small model for faster testing
const VOSK_MODEL_URL = "/models/vosk-model-small-en-us-0.15.tar.gz"; // Path to your Vosk model in /public
const TARGET_SAMPLE_RATE = 16000; // Vosk typically expects 16kHz

export default function Home() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [llmProcessedText, setLlmProcessedText] = useState("");
  const [isProcessingWithLLM, setIsProcessingWithLLM] = useState(false);
  const [llmStatus, setLlmStatus] = useState("LLM Not loaded");
  const [voskStatus, setVoskStatus] = useState("Vosk Not loaded");

  const llmEngineRef = useRef<MLCEngine | null>(null);
  
  // Refs for Vosk
  const voskModelRef = useRef<VoskModel | null>(null);
  const voskRecognizerRef = useRef<VoskKaldiRecognizer | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Refs for Waveform (shared AudioContext and MediaStream)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Effect for LLM Model Loading
  useEffect(() => {
    const initLLM = async () => {
      setLlmStatus("Initializing LLM engine...");
      try {
        const engineProgressCallback = (progress: { text: string }) => {
            setLlmStatus(`Loading LLM: ${progress.text}`);
        };
        const engine: MLCEngine = await CreateMLCEngine(SELECTED_LLM_MODEL, {
            initProgressCallback: engineProgressCallback,
        });
        llmEngineRef.current = engine;
        setLlmStatus("LLM Ready: " + SELECTED_LLM_MODEL);
      } catch (initErr) {
        console.error("Error initializing LLM engine:", initErr);
        setLlmStatus("Error loading LLM. Check console.");
        alert(`Failed to load the LLM: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
      }
    };
    initLLM();
    return () => { llmEngineRef.current?.unload(); };
  }, []);

  // Effect for Vosk Model Loading
  useEffect(() => {
    const loadVoskModel = async () => {
      setVoskStatus("Initializing Vosk... Downloading STT model...");
      try {
        const model = await Vosk.createModel(VOSK_MODEL_URL);
        voskModelRef.current = model;
        setVoskStatus("Vosk STT Model Ready.");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model.on("error", (e: any) => {
            if (e && e.event === "error" && typeof e.error === 'string') {
                console.error("Error in Vosk Model:", e.error);
                setVoskStatus("Vosk Model Error. Check console.");
                alert("Vosk STT Model error: " + e.error);
            } else {
                console.error("Unknown error in Vosk Model:", e);
                setVoskStatus("Vosk Model Unknown Error. Check console.");
                alert("Vosk STT Model unknown error. Check console.");
            }
        });
      } catch (e) {
        console.error("Failed to load Vosk model:", e);
        setVoskStatus("Vosk STT Model Load Failed. Check console/network. Ensure model is in /public" + VOSK_MODEL_URL);
        alert("Failed to load Vosk STT model: " + (e as Error).message + ". Check path and console.");
      }
    };
    loadVoskModel();
    return () => {
        voskModelRef.current?.terminate();
    }
  }, []);

  // Resample audio buffer to target sample rate (e.g., 16kHz for Vosk)
  // This is a basic offline resampler. For real-time, this might be too slow if not optimized.
  // Ideally, the AudioWorklet would handle resampling if possible, or a more performant library used.
  function resampleBuffer(inputBuffer: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
    if (inputSampleRate === targetSampleRate) {
      return inputBuffer;
    }
    const sampleRateRatio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(inputBuffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputBuffer.length; i++) {
        accum += inputBuffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  // useEffect for Audio Processing (Waveform & Vosk)
  useEffect(() => {
    const setupAudioProcessing = async () => {
      if (isListening && voskModelRef.current && canvasRef.current) {
        try {
          mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              echoCancellation: true, 
              noiseSuppression: true,
              // channelCount: 1, // Let browser decide, worklet will handle mono
              // sampleRate: TARGET_SAMPLE_RATE // Some browsers ignore this
            }
          });
          
          audioContextRef.current = new window.AudioContext();
          const currentAudioContext = audioContextRef.current;
          
          // Waveform Analyser Setup
          analyserRef.current = currentAudioContext.createAnalyser();
          analyserRef.current.fftSize = 512;
          const bufferLength = analyserRef.current.frequencyBinCount;
          dataArrayRef.current = new Uint8Array(bufferLength);
          sourceRef.current = currentAudioContext.createMediaStreamSource(mediaStreamRef.current);
          sourceRef.current.connect(analyserRef.current);
          drawWaveform();

          // Vosk Recognizer Setup
          await currentAudioContext.audioWorklet.addModule("/vosk-processor.js");
          audioWorkletNodeRef.current = new AudioWorkletNode(currentAudioContext, "vosk-processor");
          
          voskRecognizerRef.current = new voskModelRef.current.KaldiRecognizer(TARGET_SAMPLE_RATE);
          // voskRecognizerRef.current.setWords(true); // If you need word-level timestamps

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          voskRecognizerRef.current.on("result", (message: any) => {
            if (message && message.result && typeof message.result.text === 'string') {
                setTranscript(prev => prev + message.result.text + " ");
                setInterimTranscript(""); // Clear interim on final result
            } else if (message && message.event !== "partialresult") { 
                 console.log("Received recognizer message (result handler):", message);
            }
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          voskRecognizerRef.current.on("partialresult", (message: any) => {
            if (message && message.result && typeof message.result.partial === 'string') {
                setInterimTranscript(message.result.partial);
            } else if (message && message.event !== "result") { 
                console.log("Received recognizer message (partialresult handler):", message);
            }
          });
          
          audioWorkletNodeRef.current.port.onmessage = (event) => {
            const currentAudioContext = audioContextRef.current;
            if (voskRecognizerRef.current && currentAudioContext && event.data instanceof Float32Array) {
              const rawAudioData = event.data; // This is Float32Array from worklet

              // 1. Resample if necessary (audioData is Float32Array)
              let resampledAudioData = rawAudioData;
              if (currentAudioContext.sampleRate !== TARGET_SAMPLE_RATE) {
                resampledAudioData = resampleBuffer(rawAudioData, currentAudioContext.sampleRate, TARGET_SAMPLE_RATE);
              }

              // 2. Create an AudioBuffer
              // Vosk KaldiRecognizer often expects mono, 16kHz.
              // The AudioBuffer should contain Float32 data ranging from -1.0 to 1.0.
              // Our resampledAudioData from the worklet is already Float32Array.
              // We need to ensure its values are normalized if they aren't already (-1 to 1).
              // The getByteTimeDomainData in the waveform visualizer gets 0-255. 
              // The raw data from getUserMedia piped through AudioWorklet is typically already Float32 between -1 and 1.
              // Let's assume resampledAudioData is already normalized Float32.

              if (resampledAudioData.length === 0) return;

              const audioBufferForVosk = currentAudioContext.createBuffer(
                1, // numberOfChannels (mono)
                resampledAudioData.length, // length of the buffer
                TARGET_SAMPLE_RATE // sampleRate (16kHz)
              );

              // 3. Copy the resampled Float32 data into the AudioBuffer
              // The data in resampledAudioData should be between -1.0 and 1.0.
              // If it isn't, normalization would be needed here.
              audioBufferForVosk.copyToChannel(resampledAudioData, 0); // For mono, channel 0

              // 4. Pass the AudioBuffer to Vosk
              voskRecognizerRef.current.acceptWaveform(audioBufferForVosk);
            }
          };
          sourceRef.current.connect(audioWorkletNodeRef.current);
          // audioWorkletNodeRef.current.connect(currentAudioContext.destination); // Not needed if only for processing

        } catch (err) {
          console.error("Error setting up audio processing:", err);
          alert("Error setting up audio: " + (err as Error).message);
          setIsListening(false);
        }
      } else {
        // Cleanup logic
        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        voskRecognizerRef.current?.remove();
        voskRecognizerRef.current = null;
        audioWorkletNodeRef.current?.port.close();
        audioWorkletNodeRef.current?.disconnect();
        audioWorkletNodeRef.current = null;
        sourceRef.current?.disconnect();
        sourceRef.current = null;
        analyserRef.current = null;
        if (audioContextRef.current?.state !== "closed") audioContextRef.current?.close();
        audioContextRef.current = null;
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        if (canvasRef.current) {
          const context = canvasRef.current.getContext("2d");
          context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    };
    setupAudioProcessing();
    return () => { /* Main cleanup in the else block based on isListening */ };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]); // Dependencies: isListening (and indirectly voskModelRef.current via the condition)

  const drawWaveform = () => {
    if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) {
      return;
    }
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    analyser.getByteTimeDomainData(dataArray); // Get waveform data

    // Clear canvas with a specific background color
    context.fillStyle = "#2D3748"; // A nice dark cool gray (Tailwind's gray-800)
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.lineWidth = 2.5;
    context.strokeStyle = "#60a5fa"; // A pleasant blue (Tailwind's blue-400)
    context.beginPath();

    const bufferLength = dataArray.length;
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    // Start at the center-left of the canvas
    context.moveTo(0, canvas.height / 2);

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0; // Normalize data to 0-2 range (128 is the zero point)
      const y = (v * canvas.height) / 2; // Scale to canvas height, centered around 1.0 -> canvas.height/2
      
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      x += sliceWidth;
    }

    // context.lineTo(canvas.width, canvas.height / 2); // Ensure the line reaches the end if needed
    context.stroke();

    animationFrameIdRef.current = requestAnimationFrame(drawWaveform);
  };

  const toggleListening = () => {
    if (!voskModelRef.current && !isListening) {
        alert("Vosk STT model is not loaded yet. Please wait.");
        return;
    }
    if (isListening) {
        // Stop: Actual stopping is handled by useEffect cleanup when isListening changes to false
        setIsListening(false);
    } else {
        // Start: Clear previous transcripts and set isListening to true to trigger useEffect
        setTranscript("");
        setInterimTranscript("");
        setIsListening(true);
    }
  };

  const handleProcessWithLLM = async () => {
    if (!transcript) {
      alert("Nothing to process. Please speak something first.");
      return;
    }
    if (!llmEngineRef.current) {
      alert("LLM is not ready. Please wait for it to load or check for errors.");
      return;
    }
    if (isProcessingWithLLM) {
      alert("Already processing. Please wait.");
      return;
    }

    setIsProcessingWithLLM(true);
    setLlmProcessedText("Processing with LLM...");

    try {
      const llm = llmEngineRef.current;
      // Restore the intended prompt, ensuring valid string construction
      const promptLines = [
        "You are an expert text summarizer.",
        "Take the following voice transcription and produce a concise, well-formatted summary.",
        "If the text is very short, you can just proofread and rephrase it slightly for clarity.",
        "Transcription:",
        "", // for a blank line
        `"${transcript}"`, // The actual transcript, in quotes
        "", // for a blank line
        "Summary:"
      ];
      const prompt = promptLines.join("\n");
      
      const stream: AsyncIterable<ChatCompletionChunk> = await llm.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });

      setLlmProcessedText(""); 
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          setLlmProcessedText(prev => prev + content);
        }
      }

    } catch (processLlmError) {
      console.error("Error processing with LLM:", processLlmError);
      setLlmProcessedText("Error from LLM: " + String(processLlmError instanceof Error ? processLlmError.message : processLlmError));
      alert("Failed to process text with LLM. Check console for details.");
    } finally {
      setIsProcessingWithLLM(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-8 bg-background text-foreground">
      <main className="flex flex-col gap-6 w-full max-w-3xl">
        {isListening && (
            <div className="w-full h-24 mb-4 rounded-md overflow-hidden bg-muted">
                 <canvas ref={canvasRef} className="w-full h-full"></canvas>
            </div>
        )}
        <h1 className="text-3xl md:text-4xl font-bold text-center">
          Voice Dictation PWA with LLM
        </h1>
        
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Button onClick={toggleListening} variant="default" size="lg" className="w-full sm:w-auto"
            disabled={voskStatus !== "Vosk STT Model Ready." && !isListening}
          >
            {isListening ? "Stop Listening" : (voskStatus !== "Vosk STT Model Ready." ? "Loading STT..." : "Start Listening")}
          </Button>
          <Button 
            onClick={handleProcessWithLLM} 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto"
            disabled={isProcessingWithLLM || !transcript || !llmEngineRef.current || llmStatus.startsWith("Error") || llmStatus.startsWith("Initializing LLM") || llmStatus === "LLM Not loaded"}
          >
            {isProcessingWithLLM ? "Processing..." : "Process with LLM"}
          </Button>
        </div>
        <div className="text-xs text-center text-muted-foreground">
            <p>LLM Status: {llmStatus}</p>
            <p>Vosk STT Status: {voskStatus}</p>
        </div>

        <Tabs defaultValue="liveTranscript" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="liveTranscript">Live Transcript</TabsTrigger>
            <TabsTrigger value="llmProcessed">LLM Processed</TabsTrigger>
          </TabsList>
          <TabsContent value="liveTranscript">
            <Textarea
              placeholder="Speak and your words will appear here... (Offline STT with Vosk)"
              value={transcript + interimTranscript}
              readOnly
              className="min-h-[200px] md:min-h-[250px] text-lg p-4 border rounded-md shadow-sm bg-muted/20"
            />
            {isListening && interimTranscript && (
              <p className="text-sm text-muted-foreground italic text-center mt-2">
                Listening... (interim: {interimTranscript})
              </p>
            )}
          </TabsContent>
          <TabsContent value="llmProcessed">
            <Textarea
              placeholder="LLM processed text will appear here..."
              value={llmProcessedText}
              readOnly
              className="min-h-[200px] md:min-h-[250px] text-lg p-4 border rounded-md shadow-sm bg-muted/20"
            />
          </TabsContent>
        </Tabs>
        
         <div className="mt-4 p-4 border rounded-md bg-card text-card-foreground text-sm">
          <h2 className="text-lg font-semibold mb-2">Instructions:</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Wait for &quot;Vosk STT Model Ready&quot; and &quot;LLM Ready&quot; statuses.</li>
            <li>Vosk STT model ({VOSK_MODEL_URL.split("/").pop()}) and LLM model ({SELECTED_LLM_MODEL}) will download on first use.</li>
            <li>Click &quot;Start Listening&quot; for offline voice dictation. The waveform will appear.</li>
            <li>Allow microphone access if prompted.</li>
            <li>Once you stop listening, your transcript will appear.</li>
            <li>Click &quot;Process with LLM&quot; to get a summarized/proofread version using the offline LLM.</li>
            <li>Check the browser console for detailed logs or errors.</li>
          </ul>
        </div>
      </main>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        Powered by Vosk (Offline STT) & WebLLM (Offline LLM). Phase 2 Complete.
      </footer>
    </div>
  );
}
