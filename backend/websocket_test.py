import asyncio
import json
import websockets


async def test():

    uri = "ws://127.0.0.1:8000/ws"

    try:

        async with websockets.connect(uri) as websocket:

            print("✅ Connected to server")

            sample = {
                "source": "chrome_extension",
                "event": "website_opened",
                "session_id": "ABC123",
                "url": "https://fake-scholarship.xyz",
                "title": "Scholarship Portal",
                "text": "Pay ₹500 registration fee"
            }

            await websocket.send(json.dumps(sample))

            print("✅ JSON Sent")

            response = await websocket.recv()

            print("Server Response:", response)

    except Exception as e:

        print(type(e).__name__)
        print(e)


asyncio.run(test())