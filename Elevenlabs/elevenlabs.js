const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
require('dotenv').config();

/**
 * Simple ElevenLabs Text-to-Speech Module
 *
 * Usage:
 *   const elevenlabs = require('./Elevenlabs/elevenlabs');
 *   const audio = await elevenlabs.textToSpeech("Hello world!");
 */

const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY
});

// Default settings
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL_ID = "eleven_monolingual_v1";

/**
 * Convert text to speech
 *
 * @param {string} text - The text to convert to speech
 * @param {Object} options - Optional settings
 * @param {string} options.voiceId - Voice ID (default: Rachel)
 * @param {string} options.modelId - Model ID (default: eleven_monolingual_v1)
 * @returns {Promise<Buffer>} Audio data as Buffer
 */
async function textToSpeech(text, options = {}) {
    if (!text || text.trim() === '') {
        throw new Error('Text is required');
    }

    const voiceId = options.voiceId || DEFAULT_VOICE_ID;
    const modelId = options.modelId || DEFAULT_MODEL_ID;

    try {
        const audio = await client.textToSpeech.convert(voiceId, {
            text: text,
            model_id: modelId,
            output_format: "mp3_44100_128"
        });

        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of audio) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    } catch (error) {
        throw new Error(`Failed to generate speech: ${error.message}`);
    }
}

/**
 * Convert text to speech and save to file
 *
 * @param {string} text - The text to convert to speech
 * @param {string} outputPath - Path to save the MP3 file
 * @param {Object} options - Optional settings
 * @returns {Promise<void>}
 */
async function textToSpeechFile(text, outputPath, options = {}) {
    const fs = require('fs').promises;
    const audioBuffer = await textToSpeech(text, options);
    await fs.writeFile(outputPath, audioBuffer);
}

module.exports = {
    textToSpeech,
    textToSpeechFile,
    DEFAULT_VOICE_ID,
    DEFAULT_MODEL_ID
};
