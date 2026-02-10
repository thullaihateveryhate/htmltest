# ElevenLabs Text-to-Speech Module

Simple Node.js module for converting text to speech using the ElevenLabs API.

## Quick Start

```javascript
const elevenlabs = require('./Elevenlabs/elevenlabs');

// Generate speech
const audioBuffer = await elevenlabs.textToSpeech("Hello world!");

// Or save to file
await elevenlabs.textToSpeechFile("Hello world!", "speech.mp3");
```

## Configuration

Add your API key to `.env`:

```env
ELEVENLABS_API_KEY=your_api_key_here
```

Get your API key from https://elevenlabs.io

## API

### `textToSpeech(text, options)`

Returns audio as a Buffer.

**Parameters:**
- `text` (string, required): Text to convert
- `options` (object, optional):
  - `voiceId` (string): Voice ID. Default: `21m00Tcm4TlvDq8ikWAM` (Rachel)
  - `modelId` (string): Model ID. Default: `eleven_monolingual_v1`

**Returns:** `Promise<Buffer>`

### `textToSpeechFile(text, outputPath, options)`

Saves audio directly to file.

**Parameters:**
- `text` (string, required): Text to convert
- `outputPath` (string, required): Where to save MP3
- `options` (object, optional): Same as above

**Returns:** `Promise<void>`

## Examples

### Basic Usage

```javascript
const elevenlabs = require('./Elevenlabs/elevenlabs');

const audio = await elevenlabs.textToSpeech("Hello!");
console.log(`Generated ${audio.length} bytes`);
```

### Save to File

```javascript
await elevenlabs.textToSpeechFile("Hello!", "speech.mp3");
```

### Custom Voice

```javascript
const audio = await elevenlabs.textToSpeech("Hello", {
    voiceId: "EXAVITQu4vr4xnSDxMaL" // Bella
});
```

## Available Voices

- `21m00Tcm4TlvDq8ikWAM` - Rachel (default)
- `AZnzlk1XvdvUeBnXmlld` - Domi
- `EXAVITQu4vr4xnSDxMaL` - Bella
- `ErXwobaYiN019PkySvjV` - Antoni
- `MF3mGyEYCl7XYWbV9V6O` - Elli
- `TxGEqnHWrfWFTfGW9XjX` - Josh

More at https://elevenlabs.io/voice-library

## Testing

```bash
node Elevenlabs/example.js
```

## Error Handling

```javascript
try {
    const audio = await elevenlabs.textToSpeech("Hello!");
} catch (error) {
    console.error('TTS Error:', error.message);
}
```

Common errors:
- `"Text is required"` - No text provided
- `"Failed to generate speech: ..."` - API error

## Exports

```javascript
{
    textToSpeech,           // Get audio buffer
    textToSpeechFile,       // Save to file
    DEFAULT_VOICE_ID,       // "21m00Tcm4TlvDq8ikWAM"
    DEFAULT_MODEL_ID        // "eleven_monolingual_v1"
}
```
