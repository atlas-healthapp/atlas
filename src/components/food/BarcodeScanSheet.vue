<template>
  <!-- Modal opened from FoodTab's ADD TO LIBRARY panel. The actual barcode
       scanner is a full-screen system UI provided by
       @capacitor-mlkit/barcode-scanning's modular scan() API: it is not
       embeddable or stylable, so this component only ever shows a brief
       Atlas-styled status screen before/after that native UI takes over. -->
  <Teleport to="body">
    <div class="scanwrap grid-bg">
      <div class="panel-hd">
        <span>SCAN BARCODE</span>
        <span @click="$emit('close')">[ CLOSE ]</span>
      </div>
      <div v-if="!isNative" class="msg dim-text mono">
        SCANNING ISN'T AVAILABLE IN THE BROWSER PREVIEW. INSTALL THE APP TO
        THE PHONE TO TEST IT.
      </div>
      <div v-else-if="permissionDenied" class="msg dim-text mono">
        CAMERA ACCESS DENIED. ENABLE IT IN ANDROID SETTINGS TO SCAN.
      </div>
      <div v-else-if="looking" class="msg dim-text mono">LOOKING UP…</div>
      <div v-else class="msg dim-text mono">OPENING SCANNER…</div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Capacitor } from "@capacitor/core";
import { lookupBarcode } from "@/utils/foodLookup";

const emit = defineEmits(["close", "result"]);

const isNative = Capacitor.isNativePlatform();
const permissionDenied = ref(false);
const looking = ref(false);

async function runScan() {
  const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");

  const { camera } = await BarcodeScanner.checkPermissions();
  if (camera !== "granted") {
    const req = await BarcodeScanner.requestPermissions();
    if (req.camera !== "granted") {
      permissionDenied.value = true;
      return;
    }
  }

  // On Android, scan() rejects (rather than resolving with an empty
  // barcodes array) when the user backs out of the native scanner without
  // decoding anything, so cancellation must be caught here explicitly.
  let barcodes;
  try {
    ({ barcodes } = await BarcodeScanner.scan());
  } catch (err) {
    if (err?.message === "scan canceled.") {
      emit("close");
      return;
    }
    throw err;
  }

  const code = barcodes[0]?.rawValue;
  if (!code) {
    emit("close");
    return;
  }

  looking.value = true;
  const item = await lookupBarcode(code);
  emit("result", item);
}

onMounted(() => {
  if (!isNative) return;
  runScan().catch(() => emit("result", null));
});
</script>

<style scoped>
.scanwrap {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: radial-gradient(
    120% 70% at 50% 0%,
    var(--bg0) 0%,
    var(--bg1) 55%,
    var(--bg2) 100%
  );
  padding: calc(22px + env(safe-area-inset-top)) 18px;
}
.panel-hd {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 3px;
  color: var(--fam-intake);
  margin-bottom: 16px;
}
.panel-hd span:last-child {
  cursor: pointer;
  color: var(--dim);
}
.msg {
  text-align: center;
  margin-top: 60px;
  font-size: 14px;
  letter-spacing: 1px;
}
</style>
