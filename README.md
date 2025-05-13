# Voice Dictation PWA with Offline LLM & STT

This project is a Progressive Web Application (PWA) that provides voice dictation capabilities with a focus on offline functionality. Users can speak, have their voice transcribed in real-time, and then (optionally) process the transcribed text using an offline Large Language Model (LLM) for summarization or proofreading. The application also features a real-time waveform visualization of the user's voice.

## Features

*   **Real-time Voice Dictation:** Transcribes speech to text.
*   **Offline Speech-to-Text (STT):** Utilizes Vosk-Browser for in-browser, offline transcription after an initial STT model download.
*   **Offline LLM Processing:** Uses WebLLM to run a local LLM (e.g., Phi-3) for text summarization/proofreading after an initial LLM model download.
*   **Real-time Waveform Visualization:** Displays a dynamic line waveform of the microphone input using HTML5 Canvas and the Web Audio API.
*   **Tabbed Interface:** Separates live transcript from LLM-processed text.
*   **Responsive UI:** Built with Next.js and `shadcn/ui`.

## Technologies Used

*   **Framework:** Next.js (v14+ with App Router, TypeScript, Tailwind CSS)
*   **UI Components:** `shadcn/ui`
*   **Offline Speech-to-Text (STT):**
    *   `vosk-browser`: JavaScript library for running Vosk speech recognition in the browser via WebAssembly.
    *   Vosk Language Model (e.g., `vosk-model-small-en-us-0.15.tar.gz`): Served from the `public` folder.
    *   Web Audio API: `AudioContext`, `AudioWorkletNode` (for `public/vosk-processor.js`) for capturing and processing PCM audio data for Vosk.
*   **Offline LLM Text Processing:**
    *   `@mlc-ai/web-llm`: For running language models directly in the browser using WebGPU.
    *   MLC/LLM Model (e.g., `Phi-3-mini-4k-instruct-q4f16_1-MLC`): Downloaded and cached by WebLLM on first use.
*   **Waveform Visualization:**
    *   HTML5 `<canvas>` element.
    *   Web Audio API: `AudioContext`, `AnalyserNode` for real-time frequency/amplitude data.
    *   `requestAnimationFrame` for smooth rendering.
*   **State Management:** React Hooks (`useState`, `useEffect`, `useRef`).
*   **Package Manager:** npm (or yarn).

## Getting Started

### Prerequisites

*   Node.js (v18 or later recommended)
*   npm (v9 or later) or yarn

### Installation

1.  **Clone the repository (if applicable) or ensure you have the project files.**
2.  **Navigate to the project directory:**
    ```bash
    cd voice-dictation-pwa
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    # OR
    # yarn install
    ```

### Setting up Models

**1. Vosk Speech-to-Text (STT) Model:**

*   **Download a Model:**
    *   Go to the [Vosk Model Zoo](https://alphacephei.com/vosk/models).
    *   Download a suitable English model (e.g., `vosk-model-small-en-us-0.15.zip`).
*   **Prepare the Model (`.tar.gz` format):**
    1.  Unzip the downloaded file (e.g., `vosk-model-small-en-us-0.15.zip`). This will create a folder (e.g., `vosk-model-small-en-us-0.15`).
    2.  Ensure this folder directly contains the model files (`am/`, `conf/`, `graph/`, etc.).
    3.  Create a gzipped tar archive of this folder. On macOS/Linux, navigate to the directory *containing* the model folder and run:
        ```bash
        # Example: if your model folder is vosk-model-small-en-us-0.15
        tar -czvf vosk-model-small-en-us-0.15.tar.gz vosk-model-small-en-us-0.15/
        ```
*   **Place the Model:**
    1.  Create a `models` directory inside your `public` directory: `public/models/`.
    2.  Move the generated `.tar.gz` file (e.g., `vosk-model-small-en-us-0.15.tar.gz`) into `public/models/`.
    3.  Ensure the `VOSK_MODEL_URL` constant in `src/app/page.tsx` matches this path (default is `"/models/vosk-model-small-en-us-0.15.tar.gz"`).

**2. WebLLM Model (for text processing):**

*   The LLM model specified by `SELECTED_LLM_MODEL` in `src/app/page.tsx` (e.g., `Phi-3-mini-4k-instruct-q4f16_1-MLC`) will be automatically downloaded and cached by the WebLLM library in the browser on the first use. This requires an internet connection for the initial download.

### Running the Development Server

```bash
npm run dev
# OR
# yarn dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

1.  **Model Loading:**
    *   On page load, the application initializes WebLLM and starts downloading the specified LLM model (e.g., Phi-3).
    *   It also loads the Vosk STT model from the `public/models/` directory. Status indicators on the UI show the loading progress.
2.  **Voice Dictation (Offline STT):**
    *   When the user clicks "Start Listening" (and the Vosk model is ready):
        *   Microphone access is requested.
        *   An `AudioContext` is created. The microphone audio stream is connected to:
            1.  An `AnalyserNode` for the waveform visualization.
            2.  An `AudioWorkletNode` (`public/vosk-processor.js`).
        *   The `vosk-processor.js` (AudioWorklet) receives raw audio, potentially buffers it, and forwards chunks of `Float32Array` PCM data to the main thread.
        *   In the main thread (`src/app/page.tsx`), this PCM data is resampled to 16kHz (if necessary) and converted into an `AudioBuffer`.
        *   This `AudioBuffer` is fed to the Vosk `KaldiRecognizer` instance.
        *   Vosk processes the audio offline and emits `partialresult` and `result` events, which update the displayed transcript.
3.  **Waveform Visualization:**
    *   The `AnalyserNode` provides real-time audio data (time domain).
    *   A `requestAnimationFrame` loop in `src/app/page.tsx` continuously draws this data onto an HTML5 `<canvas>` element, creating a dynamic line waveform.
4.  **LLM Text Processing (Offline):**
    *   After dictation, the user can click "Process with LLM".
    *   The transcribed text is sent as a prompt to the loaded WebLLM engine.
    *   WebLLM processes the text using the locally running LLM (e.g., Phi-3) and streams the output back.
    *   The processed text is displayed in a separate tab.

## Development Journey Highlights

1.  **Initial Setup & UI (Early Stages):**
    *   Project initialized with Next.js, TypeScript, Tailwind CSS.
    *   `shadcn/ui` was added for core UI components like `Button`, `Textarea`, and later `Tabs`.
    *   (Initially, a placeholder using the browser's built-in Web Speech API was implemented for basic dictation, which was later replaced for offline capability).

2.  **Offline LLM Integration (Mid Stages):**
    *   `@mlc-ai/web-llm` library was introduced to enable running LLMs client-side.
    *   Functionality to load an LLM (like Phi-3) and process text with it was added.
    *   The Vercel `ai` SDK was installed with the intent of potentially using its utilities, though WebLLM is currently called via its direct API.

3.  **Waveform Visualization (Mid Stages):**
    *   An HTML5 `<canvas>` was added.
    *   The Web Audio API (`AudioContext`, `AnalyserNode`) was integrated to capture audio data for visualization.
    *   The rendering logic for the waveform was developed and refined iteratively (from bar-based designs to the current line waveform).

4.  **Offline Speech-to-Text (Later Stages):**
    *   To achieve full offline transcription, the browser's Web Speech API was replaced.
    *   `vosk-browser` library was installed.
    *   A Vosk STT language model was prepared and added to the `public` assets.
    *   An `AudioWorkletNode` (`public/vosk-processor.js`) was created to handle the audio pipeline from the microphone to the Vosk engine, including buffering.
    *   Logic for resampling audio to 16kHz and converting it to the `AudioBuffer` format expected by Vosk's `acceptWaveform` method was implemented and debugged.

5.  **Debugging & Refinement (Throughout):**
    *   Addressed various linter errors and TypeScript type issues.
    *   Resolved JavaScript parsing errors, particularly with template literals and module imports.
    *   Tackled runtime errors related to Web Audio API usage and library-specific API expectations (e.g., data format for Vosk).

## Potential Future Enhancements

*   More sophisticated audio resampling in the AudioWorklet for better quality.
*   Allow users to select different Vosk STT models or LLM models.
*   Implement more advanced PWA features (e.g., full offline caching of all assets).
*   Explore deeper integration with the Vercel AI SDK for managing interactions with WebLLM if beneficial.
*   UI for managing downloaded models.
*   Error handling and user feedback improvements.

---

This README provides a good overview for anyone looking to understand or contribute to the project.
