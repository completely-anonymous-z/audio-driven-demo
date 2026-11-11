# AnyTalker supplementary experiments

Anonymous review supplement organized by reviewer, then by each weakness (W) or question (Q). The selected comment is shown verbatim with its supporting evidence. Result tabs reuse the same tables and video players across review questions.

Serve this directory through an HTTP server with byte-range support for video seeking. No build step or external runtime dependencies are required.

## Reviewer navigation

- `#9eqr-W1`, `#BdXy-Q2`, and `#q7Va-W2` open individual review comments.
- `#BdXy-Q2/e44` opens a specific experiment within that review comment.
- Existing `#e1` through `#e45` links remain valid and select the corresponding reviewer and question. `#e8-data` opens the curve's numerical table.
- `data/reviewers.json` contains 18 original comments with experimental evidence: 7 for 9eqr, 7 for BdXy, and 4 for q7Va. Text-only replies and comments awaiting evidence are omitted from the website; original W/Q numbers are retained. `data/experiments.json` remains the single source of quantitative values and video metadata.
- Evidence nodes are cached and moved into the active view. Switching questions or evidence pauses playback. Video players are created when needed; media files are not duplicated.
- Reviewer and evidence tabs support Left/Right arrow keys and Home/End. Question links support browser history and direct sharing.

## Experiment identifiers

| Experiment | Content |
| --- | --- |
| E1–E4 | Happy speech, sad speech, muting, and audio delay |
| E5 | Component ablations |
| E6 | Training-data ablations |
| E7 | Real-data scaling at fixed 5K updates |
| E8 | Learning curves and their complete numerical table |
| E9 | Confidence intervals for metric and preference differences |
| E10 | Metric agreement with human preference votes |
| E11–E13 | Selected group-conversation clips with GT |
| E14–E43 | All 30 group scenes, each with GT and two seeds |
| E44–E45 | Matched text-instruction comparisons |

Each experiment has a direct link, such as `#e13`. The figure and data table for E8 share the experiment number; `#e8-data` opens the underlying values. The scene selector opens E14–E43 directly.

All experiments use `These people are talking to each other.` except the explicit E44/E45 instruction variants. Their exact prompts are shown with the videos. Video comparisons support shared playback, seeking, speed, and one selected audio source.

The `data/` directory contains displayed results and CSV tables. All media are local under `assets/`; no analytics or third-party embeds are used.

The planned code release includes inference, training, and data preparation and concatenation. This website provides supplementary results.

Published within the original anonymous demo at https://completely-anonymous-z.github.io/audio-driven-demo/rebuttal/. The original demo homepage embeds this subpage near its end.
