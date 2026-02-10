type ZxingBrowserModule = typeof import('@zxing/browser');

let zxingBrowserPromise: Promise<ZxingBrowserModule> | null = null;

async function loadZxingBrowser(): Promise<ZxingBrowserModule> {
  if (!zxingBrowserPromise) {
    zxingBrowserPromise = import('@zxing/browser');
  }
  return zxingBrowserPromise;
}

export async function decodeQrFromImageFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const { BrowserQRCodeReader } = await loadZxingBrowser();
    const reader = new BrowserQRCodeReader();
    const decoded = await reader.decodeFromImageUrl(url);
    return decoded.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}
