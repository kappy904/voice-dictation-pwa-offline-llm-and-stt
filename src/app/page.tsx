"use client";

import { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateMLCEngine, MLCEngine, ChatCompletionChunk } from "@mlc-ai/web-llm";
import { FlickeringGrid } from "@/components/ui/flickering-grid";

// Define a model string - using a small, fast-loading model for initial setup
// You can find more models at https://mlc.ai/package/
// const SELECTED_MODEL = "Llama-3-8B-Instruct-q4f16_1-MLC"; // A general purpose Llama 3 model
// const SELECTED_MODEL = "gemma-2b-it-q4f16_1-MLC"; // A smaller Gemma model if Llama is too slow initially
const SELECTED_LLM_MODEL = "Phi-3-mini-4k-instruct-q4f16_1-MLC"; // A very small model for faster testing

// REMOVED: const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export default function Home() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [llmProcessedText, setLlmProcessedText] = useState("");
  const [isProcessingWithLLM, setIsProcessingWithLLM] = useState(false);
  const [llmStatus, setLlmStatus] = useState("LLM Not loaded");
  const [sttStatus, setSttStatus] = useState("STT Ready");
  const [activeTab, setActiveTab] = useState("liveTranscript");
  const [speechRecognitionSvc, setSpeechRecognitionSvc] = useState<any>(null); // State for SpeechRecognition constructor

  const llmEngineRef = useRef<MLCEngine | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Refs for Waveform (shared AudioContext and MediaStream)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Effect to initialize SpeechRecognition service on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSpeechRecognitionSvc(() => SR); // Use functional update as SR is a constructor
    }
  }, []);

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

  // useEffect for Audio Processing (Waveform & Web Speech API)
  useEffect(() => {
    const setupAudioProcessing = async () => {
      if (isListening && canvasRef.current) {
        try {
          mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
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

          // Web Speech API Setup
          if (!speechRecognitionSvc) { // Check if speechRecognitionSvc is loaded
            setSttStatus("Web Speech API not supported by this browser or still loading.");
            console.error("Web Speech API not supported or not yet loaded.");
            setIsListening(false);
            return;
          }
          
          const recognition = new speechRecognitionSvc(); // Use the state variable
          recognitionRef.current = recognition;
          
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "en-US";

          recognition.onstart = () => {
            setSttStatus("Listening...");
          };

          recognition.onresult = (event: any) => {
            let finalTranscript = "";
            let currentInterimTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              } else {
                currentInterimTranscript += event.results[i][0].transcript;
              }
            }
            if (finalTranscript) {
                setTranscript(prev => prev + finalTranscript + " ");
            }
            setInterimTranscript(currentInterimTranscript);
          };

          recognition.onerror = (event: any) => {
            console.error("Speech recognition error:", event.error);
            setSttStatus(`STT Error: ${event.error}`);
            if (event.error === 'not-allowed') {
                alert("Microphone access was denied. Please allow microphone access in your browser settings.");
            } else if (event.error === 'no-speech') {
                setSttStatus("No speech detected. Try speaking louder or closer to the microphone.");
            }
          };

          recognition.onend = () => {
            if (recognitionRef.current === recognition) {
                 setIsListening(false);
                 setSttStatus("STT Ready");
            }
          };
          
          recognition.start();

        } catch (err) {
          console.error("Error setting up audio processing:", err);
          setSttStatus("Error setting up audio: " + (err as Error).message);
          alert("Error setting up audio: " + (err as Error).message);
          setIsListening(false);
        }
      } else {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current.onstart = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current = null;
        }

        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        
        sourceRef.current?.disconnect();
        sourceRef.current = null;
        analyserRef.current = null;
        
        if (audioContextRef.current?.state !== "closed") {
            audioContextRef.current?.close().catch(e => console.error("Error closing audio context", e));
        }
        audioContextRef.current = null;
        
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        
        if (canvasRef.current) {
          const context = canvasRef.current.getContext("2d");
          context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        setSttStatus("STT Ready");
      }
    };
    setupAudioProcessing();
    return () => { /* Main cleanup in the else block based on isListening */ };
  }, [isListening, speechRecognitionSvc]);

  const drawWaveform = () => {
    if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) {
      return;
    }
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    analyser.getByteTimeDomainData(dataArray);

    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || "oklch(0.7 0.15 190)";
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || "oklch(0.2 0.07 250)";
    
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.lineWidth = 2.5;
    context.strokeStyle = primaryColor;
    context.beginPath();

    const bufferLength = dataArray.length;
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    context.moveTo(0, canvas.height / 2);

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      x += sliceWidth;
    }

    context.stroke();

    animationFrameIdRef.current = requestAnimationFrame(drawWaveform);
  };

  const toggleListening = () => {
    if (isListening) {
      const recognition = recognitionRef.current;
      if (recognition) {
        // recognition.stop(); // This is handled by the effect cleanup
      }
      setIsListening(false);
    } else {
      if (!speechRecognitionSvc) { // Check if speechRecognitionSvc is loaded
        alert("Web Speech API is not supported by your browser or is still initializing. Please try again shortly.");
        setSttStatus("Web Speech API not supported/ready.");
        return;
      }
      setTranscript("");
      setInterimTranscript("");
      setIsListening(true);
    }
  };

  const handleProcessWithLLM = async () => {
    if (!transcript.trim()) {
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
    setActiveTab("llmProcessed");

    try {
      const llm = llmEngineRef.current;
      const promptLines = [
        "You are an expert text summarizer.",
        "Take the following voice transcription and produce a concise, well-formatted summary.",
        "If the text is very short, you can just proofread and rephrase it slightly for clarity.",
        "Transcription:",
        "",
        `"${transcript}"`,
        "",
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
    <div className="futuristic-bg flex flex-col items-center justify-center min-h-screen p-4 md:p-8 text-foreground">
      <FlickeringGrid
        className="z-0 absolute inset-0 size-full"
        squareSize={4}
        gridGap={6}
        color="oklch(var(--muted-foreground))" // Using theme variable
        maxOpacity={0.7} // Softer opacity
        flickerChance={0.2} // Less frequent flicker
      />
      <main className="flex flex-col gap-6 w-full max-w-3xl bg-card/80 backdrop-blur-sm p-6 rounded-xl shadow-2xl z-10 relative">
        {isListening && (
            <div className="w-full h-24 mb-4 rounded-md overflow-hidden border border-primary/50">
                 <canvas ref={canvasRef} className="w-full h-full"></canvas>
            </div>
        )}
        <h1 className="text-3xl md:text-4xl font-bold text-center text-glow">
          Speech to Text + WebLLM summary
        </h1>
        
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Button 
            onClick={toggleListening} 
            variant={isListening ? "destructive" : "default"} 
            size="lg" 
            className={`w-full sm:w-auto ${isListening ? "" : "button-glow"}`}
            disabled={sttStatus === "Web Speech API not supported." || (isListening && sttStatus !== "Listening...")}
          >
            {isListening ? "Stop Listening" : (sttStatus === "Web Speech API not supported." ? "STT Not Supported" : "Start Listening")}
          </Button>
          <Button 
            onClick={handleProcessWithLLM} 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto"
            disabled={isProcessingWithLLM || !transcript.trim() || !llmEngineRef.current || llmStatus.startsWith("Error") || llmStatus.startsWith("Initializing LLM") || llmStatus === "LLM Not loaded"}
          >
            {isProcessingWithLLM ? "Processing..." : "Process with LLM"}
          </Button>
        </div>
        <div className="text-xs text-center text-muted-foreground">
            <p>LLM Status: {llmStatus}</p>
            <p>STT Status: {sttStatus}</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-muted/50">
            <TabsTrigger value="liveTranscript">Live Transcript</TabsTrigger>
            <TabsTrigger value="llmProcessed">LLM Output</TabsTrigger>
          </TabsList>
          <TabsContent value="liveTranscript">
            <Textarea
              placeholder="Speak and your words will appear here..."
              value={transcript + interimTranscript}
              readOnly
              className="min-h-[200px] md:min-h-[250px] text-lg p-4 border border-border rounded-md shadow-sm bg-muted/30 backdrop-blur-sm"
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
              className="min-h-[200px] md:min-h-[250px] text-lg p-4 border border-border rounded-md shadow-sm bg-muted/30 backdrop-blur-sm"
            />
          </TabsContent>
        </Tabs>
        
         <div className="mt-4 p-4 border border-border rounded-md bg-card/70 backdrop-blur-sm text-card-foreground text-sm">
          <h2 className="text-lg font-semibold mb-2 text-glow">Instructions:</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Wait for &quot;LLM Ready&quot; status. STT should be ready by default.</li>
            <li>LLM model ({SELECTED_LLM_MODEL}) will download on first use. This may take a few minutes.</li>
            <li>Click &quot;Start Listening&quot; for voice dictation. The waveform will appear.</li>
            <li>Allow microphone access if prompted.</li>
            <li>Once you stop listening, your transcript will appear in the &quot;Live Transcript&quot; tab.</li>
            <li>Click &quot;Process with LLM&quot; to send the transcript to the LLM. The app will switch to the &quot;LLM Output&quot; tab.</li>
            <li>Check the browser console for detailed logs or errors.</li>
          </ul>
        </div>
      </main>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        Powered by Web Speech API & WebLLM.
      </footer>
    </div>
  );
}
