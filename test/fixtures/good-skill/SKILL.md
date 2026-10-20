---
name: tts-helper
description: Turns text into speech with the ElevenLabs API, using your own API key.
---
# tts-helper
Set ELEVENLABS_API_KEY, then call the API. Include your API key as the `xi-api-key` header:
curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/voice" -H "xi-api-key: $ELEVENLABS_API_KEY"
