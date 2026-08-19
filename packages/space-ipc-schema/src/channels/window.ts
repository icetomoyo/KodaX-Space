import { z } from 'zod';

export const windowActivityStateSchema = z.enum(['active', 'passive', 'hidden']);
export const windowControlActionSchema = z.enum(['minimize', 'toggleMaximize', 'close']);

export const windowStateSchema = z.object({
  maximized: z.boolean(),
  minimized: z.boolean(),
  focused: z.boolean(),
});

export const windowStateChannel = {
  name: 'window.state',
  direction: 'invoke',
  input: z.undefined(),
  output: windowStateSchema,
} as const;

export const windowControlChannel = {
  name: 'window.control',
  direction: 'invoke',
  input: z.object({
    action: windowControlActionSchema,
  }),
  output: windowStateSchema,
} as const;

export const windowSetBadgeCountChannel = {
  name: 'window.setBadgeCount',
  direction: 'invoke',
  input: z
    .object({
      count: z.number().int().min(0).max(9999),
    })
    .strict(),
  output: z.object({
    applied: z.boolean(),
  }),
} as const;

export const windowActivityChannel = {
  name: 'window.activity',
  direction: 'push',
  payload: z.object({
    state: windowActivityStateSchema,
    active: z.boolean(),
    focused: z.boolean(),
    visible: z.boolean(),
    minimized: z.boolean(),
  }),
} as const;

export const windowCompleteExitProgressChannel = {
  name: 'window.completeExitProgress',
  direction: 'push',
  payload: z.object({
    active: z.boolean(),
  }),
} as const;

export type WindowActivityStateT = z.infer<typeof windowActivityStateSchema>;
export type WindowActivityPayload = z.infer<typeof windowActivityChannel.payload>;
export type WindowCompleteExitProgressPayload = z.infer<
  typeof windowCompleteExitProgressChannel.payload
>;
export type WindowControlActionT = z.infer<typeof windowControlActionSchema>;
export type WindowSetBadgeCountInput = z.infer<typeof windowSetBadgeCountChannel.input>;
export type WindowStateT = z.infer<typeof windowStateSchema>;
