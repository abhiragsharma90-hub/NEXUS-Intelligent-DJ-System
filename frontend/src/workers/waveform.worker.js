self.onmessage = (event) => {
  const { channels, duration, bins } = event.data;
  const channelPeaks = channels.map((samples) => {
    const peaks = new Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
      const start = Math.floor(bin * samples.length / bins);
      const end = Math.max(start + 1, Math.floor((bin + 1) * samples.length / bins));
      let minimum = 1;
      let maximum = -1;
      for (let sample = start; sample < end; sample += 1) {
        minimum = Math.min(minimum, samples[sample]);
        maximum = Math.max(maximum, samples[sample]);
      }
      peaks[bin] = [minimum, maximum];
    }
    return peaks;
  });
  const absolutePeaks = channelPeaks.flatMap((channel) => channel.map(([minimum, maximum]) => Math.max(Math.abs(minimum), Math.abs(maximum))));
  absolutePeaks.sort((first, second) => first - second);
  const normalization = absolutePeaks[Math.min(absolutePeaks.length - 1, Math.floor(absolutePeaks.length * 0.999))] || 1;
  const normalize = (peaks) => peaks.map(([minimum, maximum]) => [
    Number(Math.max(-1, minimum / normalization).toFixed(4)),
    Number(Math.min(1, maximum / normalization).toFixed(4)),
  ]);

  self.postMessage({
    duration,
    peaks: {
      left: normalize(channelPeaks[0]),
      right: normalize(channelPeaks[1]),
    },
  });
};
