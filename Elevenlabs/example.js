const elevenlabs = require('./elevenlabs');

// Example 1: Get audio as buffer
async function example1() {
    try {
        const audioBuffer = await elevenlabs.textToSpeech("Hello from ElevenLabs!");
        console.log(`Generated audio: ${audioBuffer.length} bytes`);
        // Use audioBuffer as needed (send to client, save to file, etc.)
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Example 2: Save to file
async function example2() {
    try {
        await elevenlabs.textToSpeechFile(
            "This is a test of the text to speech system.",
            "output.mp3"
        );
        console.log('Audio saved to output.mp3');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Example 3: Use custom voice
async function example3() {
    try {
        const audioBuffer = await elevenlabs.textToSpeech(
            "Using a custom voice!",
            { voiceId: "21m00Tcm4TlvDq8ikWAM" } // Rachel voice
        );
        console.log(`Generated with custom voice: ${audioBuffer.length} bytes`);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run examples
async function main() {
    console.log('Example 1: Get audio buffer');
    await example1();

    console.log('\nExample 2: Save to file');
    await example2();

    console.log('\nExample 3: Custom voice');
    await example3();
}

main();
