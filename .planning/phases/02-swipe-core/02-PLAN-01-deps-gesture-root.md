---
id: 02-PLAN-01
title: Install Dependencies & Wrap App Root with GestureHandlerRootView
wave: 1
depends_on: []
files_modified:
  - package.json
  - app/_layout.tsx
autonomous: true
requirements_addressed:
  - REQ-002
---

# Plan 01: Install Dependencies & Wrap App Root

## Objective

Install the three new native dependencies required for Phase 2 (react-native-gesture-handler, react-native-reanimated, expo-audio) and wrap the Expo Router root layout with `GestureHandlerRootView`. Without this wrapper, all gesture detection silently fails.

Purpose: All Phase 2 gesture and audio work blocks on this step. Wave 1 installs and layout change must land first.

Output: Updated package.json (new deps) and app/_layout.tsx with GestureHandlerRootView wrapping the existing auth-check layout.

## Tasks

<task id="T02-01-1">
<title>Task 1: Install gesture and audio dependencies via expo install</title>

<read_first>
- .planning/phases/02-swipe-core/02-RESEARCH.md (Standard Stack section — exact install command and package legitimacy audit)
- package.json (current deps — verify react-native-gesture-handler, react-native-reanimated, expo-audio are absent before installing)
</read_first>

<action>
Run the following install command from the project root (Expo's install command resolves correct versions for SDK 52 automatically — do not pin versions manually):

```
npx expo install react-native-gesture-handler react-native-reanimated expo-audio
```

After install, verify the three packages appear in package.json dependencies. The expected versions are react-native-gesture-handler ~2.22.1, react-native-reanimated ~3.16.x, and expo-audio matching the SDK 52 compatible version.

Do not install any other packages in this task.
</action>

<acceptance_criteria>
- package.json dependencies includes react-native-gesture-handler, react-native-reanimated, and expo-audio
- `npx tsc --noEmit` exits 0 (no TypeScript errors from new packages)
- `npx expo lint` exits 0
</acceptance_criteria>
</task>

<task id="T02-01-2">
<title>Task 2: Wrap app/_layout.tsx root with GestureHandlerRootView</title>

<read_first>
- app/_layout.tsx (MUST read current file before editing — auth layout already has Slot + useAuthStore initialization)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 1 — the GestureHandlerRootView setup code block; Pitfall note: gestures silently fail without this wrapper)
</read_first>

<action>
Edit app/_layout.tsx to import GestureHandlerRootView from 'react-native-gesture-handler' and wrap the existing return value so GestureHandlerRootView is the outermost element with style={{ flex: 1 }}.

The existing loading indicator branch (isLoading → ActivityIndicator) and the Slot return must both remain inside GestureHandlerRootView. The auth initialization logic (useAuthStore, useEffect) is unchanged.

Final structure:
- GestureHandlerRootView (flex: 1)
  - If isLoading: View with ActivityIndicator (existing)
  - Else: Slot (existing)

Do not change any other behavior — only add the wrapper.
</action>

<acceptance_criteria>
- app/_layout.tsx imports GestureHandlerRootView from 'react-native-gesture-handler'
- The outermost JSX element in RootLayout's return is GestureHandlerRootView with style={{ flex: 1 }}
- useAuthStore and the isLoading guard remain unchanged inside the wrapper
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</acceptance_criteria>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| npm registry → local node_modules | Third-party packages installed via expo install |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-SC | Tampering | npm package install (react-native-gesture-handler, react-native-reanimated, expo-audio) | mitigate | All three packages verified in Package Legitimacy Audit in 02-RESEARCH.md — Software Mansion (RNGH, Reanimated) and Expo (expo-audio) official maintainers; no slopcheck concerns |
</threat_model>

<verification>
After both tasks complete:
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
- app/_layout.tsx has GestureHandlerRootView as outermost element
- package.json includes all three new packages
</verification>

<success_criteria>
- All three packages present in node_modules and package.json
- App root is wrapped with GestureHandlerRootView so gesture detection works throughout the app
- No TypeScript or lint errors introduced
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-01-SUMMARY.md` when done
</output>
