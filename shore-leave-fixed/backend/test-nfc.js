const { NFC } = require("nfc-pcsc");

const nfc = new NFC();

console.log("Waiting for NFC reader...");

nfc.on("reader", reader => {
    console.log("Reader Connected:", reader.name);

    reader.on("card", card => {
        console.log("Card detected. UID withheld from logs.");
    });

    reader.on("card.off", () => {
        console.log("Card Removed");
    });

    reader.on("error", err => {
        console.error('NFC reader error.');
    });
});

nfc.on("error", err => {
    console.error('NFC service error.');
});
