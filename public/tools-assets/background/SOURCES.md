# Local background removal assets

- ONNX Runtime Web 1.29.0: https://github.com/microsoft/onnxruntime (MIT; adjacent license).
- U2NETP model: https://github.com/xuebinqin/U-2-Net (Apache-2.0; adjacent license).
- Converted model: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- Model MD5: 8e83ca70e441ab06c318d82300c84806

Runtime files copied from the installed onnxruntime-web package. All inference and image processing run locally in a Web Worker. The first use downloads these assets from the app's own origin.
