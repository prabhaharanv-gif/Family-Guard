# Family Background art

Drop image files here and the Family Background picks them up by name. No code change.
Anything missing falls back to the built-in vector drawing, so you can add files one at a
time. Use WebP (or PNG); WebP quality about 80 keeps each file small.

## Scenes — `scenes/`

| File | Size | Notes |
|---|---|---|
| `sunset.webp` `home.webp` `garden.webp` `park.webp` | **1080 x 900 px** | The whole background. Ground runs off the bottom edge. |
| `<scene>-front.webp` (optional) | 1080 x 900 px, transparent | Drawn in front of the people: grass, flowers, a fence along the bottom edge. |

- People stand on a line **84% of the way down** (y = 756 of 900), centred, using about the
  middle 65% of the width (`home`: the group stands left of centre, house on the right).
  Keep that band free of tall objects.
- The top of the picture is faded out by the page, so keep it calm (sky, soft clouds).
- No people, faces or text in the scene.
- To move the standing line, change `SCENE_FEET` in `src/lib/familyAssets.js`.

## Characters — `people/`

Transparent background, standing, seen **from behind**, relaxed arms, **feet touching the
bottom edge**, cropped tight (no empty space above the head or under the feet), no ground
shadow (the app adds one). Same lighting, style and **scale** across all of them: draw
the adult man 1200 px tall and the others in proportion.

| File | Who | Height at that scale |
|---|---|---|
| `man-adult.webp` | Father, Adult man (26+) | 1200 px |
| `woman-adult.webp` | Mother, Adult woman (26+) | about 1130 px |
| `man-young.webp` | young man (18-25) | about 1130 px |
| `woman-young.webp` | young woman (18-25) | about 1060 px |
| `boy-teen.webp` | boy 13-17 | about 1030 px |
| `girl-teen.webp` | girl 13-17 | about 1030 px |
| `boy-child.webp` | boy 8-12 | about 790 px |
| `girl-child.webp` | girl 8-12 | about 790 px |
| `boy-small.webp` | boy 4-7 | about 620 px |
| `girl-small.webp` | girl 4-7 | about 620 px |
| `baby.webp` | age 0-3 | about 410 px |

That is 11 characters. Width is whatever the figure needs (roughly 40-60% of its height).
The app fits each image into a box sized by age, so small differences in your proportions
are fine; a wrong aspect ratio is never stretched.

Optional extra looks: `girl-child-2.webp`, `girl-child-3.webp` and so on (any of the names
above). Two daughters of the same age in one family then take different looks in turn.

If a character is missing the nearest age of the same side (boy / man, girl / woman) is
used; if none exists at all, the vector figure is drawn.
