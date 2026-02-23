"""
boot.py — Raspberry Pi Pico USB configuration for Claude Code approval button.
Enables the CDC data serial port so the bridge can communicate with the Pico.
Copy this file to the CIRCUITPY drive root.
"""
import usb_cdc

usb_cdc.enable(data=True)
