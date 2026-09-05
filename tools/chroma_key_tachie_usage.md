# chroma_key_tachie.py

Deterministic, LLM-free chroma key extraction for RPGBox portraits.

## Basic usage

```powershell
python .\tools\chroma_key_tachie.py `
  --input .\portrait_screen.png `
  --output .\portrait_transparent.png
```

`auto` mode samples the border and estimates the actual background color, which is usually the better choice for SDXL-generated images.
It first checks the four corners and clusters similar colors with `--corner-threshold`.

## Manual screen color

```powershell
python .\tools\chroma_key_tachie.py `
  --input .\portrait_screen.png `
  --output .\portrait_transparent.png `
  --screen-color "#00FF00"
```

## Force a known background

```powershell
python .\tools\chroma_key_tachie.py `
  --input .\portrait_screen.png `
  --output .\portrait_transparent.png `
  --screen green
```

## Tuning

- `--transparent-distance`: pixels at or below this RGB distance become fully transparent
- `--opaque-distance`: pixels at or above this RGB distance stay fully opaque
- `--gamma`: controls the softness of the transition
- `--despill`: reduces background color spill on edge pixels
- `--corner-size`: how many pixels to sample in each corner
- `--corner-threshold`: maximum RGB offset sum for corner colors to be grouped together
- `--border-width`: how many pixels around the edge are used for auto background sampling
- `--keep-transparent-rgb`: keeps RGB values inside transparent pixels instead of clearing them

## Notes

- The script works best with a mostly solid chroma background.
- It preserves soft alpha instead of hard-thresholding everything.
- It is separate from `tools/tachie.py`, which still handles fit/validate/review.
