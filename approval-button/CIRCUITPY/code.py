"""
code.py — Claude Code hardware approval button firmware.
Runs on Raspberry Pi Pico with CircuitPython.

Wiring:
  GP15 (pin 20) -> Button switch (NO terminal)
  GP16 (pin 21) -> Button LED (+) terminal
  GND  (pin 23) -> Button switch (COM) + LED (-) terminal

Behavior:
  - Sends "PRESS\n" over USB serial when button is pressed
  - Receives "ON\n" / "OFF\n" to control the LED
  - Double-blinks LED on startup

Copy this file to the CIRCUITPY drive root.
"""
import board
import digitalio
import time
import usb_cdc

# --- Pin setup ---

led = digitalio.DigitalInOut(board.GP16)
led.direction = digitalio.Direction.OUTPUT

button = digitalio.DigitalInOut(board.GP15)
button.direction = digitalio.Direction.INPUT
button.pull = digitalio.Pull.UP  # Active low: pressed = False

serial = usb_cdc.data  # Data serial port (enabled by boot.py)

# --- Startup indicator: double-blink ---

for _ in range(2):
    led.value = True
    time.sleep(0.15)
    led.value = False
    time.sleep(0.15)

# --- Main loop ---

buf = b""
last_press_time = 0
DEBOUNCE_S = 0.25

while True:
    now = time.monotonic()

    # Button press detection (active low with pull-up)
    if not button.value and (now - last_press_time) > DEBOUNCE_S:
        serial.write(b"PRESS\n")
        last_press_time = now
        # Brief flash as tactile feedback
        saved = led.value
        led.value = True
        time.sleep(0.05)
        led.value = saved

    # Non-blocking serial read for LED commands
    if serial.in_waiting > 0:
        buf = buf + serial.read(serial.in_waiting)
        idx = buf.find(b"\n")
        while idx >= 0:
            line = buf[:idx]
            buf = buf[idx + 1:]
            cmd = line.decode("utf-8").strip()
            if cmd == "ON":
                led.value = True
            elif cmd == "OFF":
                led.value = False
            idx = buf.find(b"\n")

    time.sleep(0.01)  # 10ms loop — responsive without busy-waiting
