# Choosing the shop setup

GestiMarket adapts to each shop: with or without a PC, with or without Internet, one or several devices.

| Situation | Server (keeps the data) | Other devices | Internet |
|---|---|---|---|
| A single phone | The phone | — | No |
| Phone + TV (customer display) | The phone, with its hotspot | Android TV | No |
| Phone + several tills | The phone | Phones, tablets, TV, iPhone | No |
| Server PC in the shop | The PC | PCs, phones, tablets, TV, iPhone, over Wi-Fi | No |
| The owner checks from afar | PC with its Internet address | “Owner space” app, Safari | Yes |

## Device modes (Station & network)

- **Single station**: the database is on this device, nobody else connects to it.
- **Shop server** (PC or Android phone): the database is here and is shared with the shop's other devices.
- **Client station**: the device works on the shop server's database.

To change mode: **Station & network**, choose the mode, then **Save and restart**. On a station that keeps the data, a manager's PIN is asked.

## Connecting a device to the server

On the new device:

- **Android app**: “Join a shop” (first start) or Station & network → Client station. The shop is found by itself; otherwise, scan the server's QR code.
- **iPhone, iPad, browser**: scan the QR code shown on the server (Station & network), or type its address, for example `http://192.168.1.10:7878`.

The **https** address (port 7879) enables the browser camera to scan barcodes. The first time, the browser shows “connection not private”: tap “Advanced”, then “Continue”.

## The shop's Internet address (server PC)

With the PRO plan, the server PC can have an **Internet address** (`https://gm-000123.gestimarket.shop`): the owner opens the shop from anywhere. Settings → Network & mobile → **Create the Internet address**. Each phone connecting from the Internet must first be **authorised** by the administrator (access code or shop account).
