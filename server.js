import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Download, ArrowLeft } from 'lucide-react-native';
import ResultCard from '../components/ResultCard';
import { ART_STYLES } from '../utils/constants';

// ✅ Simple — backend now returns real HTTPS URLs, just download directly
async function imageToLocalFile(outputUrl, style) {
  const dest = `${FileSystem.cacheDirectory}clipart_${style}_${Date.now()}.png`;
  await FileSystem.downloadAsync(outputUrl, dest);
  return dest;
}

export default function ResultsScreen({ navigation, route }) {
  const { results, originalImage, retry } = route.params;
  const success = results.filter(r => r.status === 'done');
  const [downloading, setDownloading] = useState(null);
  const headerFade = useRef(new Animated.Value(0)).current;
  const styleMap = Object.fromEntries(ART_STYLES.map(s => [s.id, s]));

  useEffect(() => {
    Animated.timing(headerFade, {
      toValue: 1, duration: 600, useNativeDriver: true
    }).start();
  }, []);

  const download = async (result) => {
    try {
      setDownloading(result.style);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Storage permission needed to save images.');
        return;
      }
      const localFile = await imageToLocalFile(result.outputUrl, result.style);
      await MediaLibrary.saveToLibraryAsync(localFile);
      Alert.alert('Saved ✓', `${styleMap[result.style]?.name} clipart saved to gallery!`);
    } catch (e) {
      console.error('Download error:', e);
      Alert.alert('Error', 'Failed to save: ' + e.message);
    } finally {
      setDownloading(null);
    }
  };

  const share = async (result) => {
    try {
      const localFile = await imageToLocalFile(result.outputUrl, result.style);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localFile, {
          mimeType: 'image/png',
          dialogTitle: 'Share your Clipart',
        });
      } else {
        Alert.alert('Share not available', 'Sharing is not supported on this device.');
      }
    } catch (e) {
      console.error('Share error:', e);
      Alert.alert('Error', 'Failed to share: ' + e.message);
    }
  };

  const downloadAll = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Storage permission needed.');
      return;
    }
    for (const r of success) { await download(r); }
  };

  return (
    <LinearGradient colors={['#07070e', '#0c0c18']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false}>

          <Animated.View style={{
            opacity: headerFade,
            paddingHorizontal: 24, paddingTop: 16, marginBottom: 20
          }}>
            <TouchableOpacity
              onPress={() => navigation.popToTop()}
              style={{
                flexDirection: 'row', alignItems: 'center',
                gap: 6, marginBottom: 18
              }}
            >
              <ArrowLeft size={16} color="#7c5cfc" strokeWidth={2.5} />
              <Text style={{ color: '#7c5cfc', fontSize: 14, fontWeight: '600' }}>
                Start Over
              </Text>
            </TouchableOpacity>

            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 7,
              alignSelf: 'flex-start',
              backgroundColor: 'rgba(124,92,252,0.1)', borderWidth: 1,
              borderColor: 'rgba(124,92,252,0.28)', borderRadius: 20,
              paddingHorizontal: 14, paddingVertical: 6, marginBottom: 12
            }}>
              <View style={{
                width: 7, height: 7, borderRadius: 3.5,
                backgroundColor: '#22c55e'
              }} />
              <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '700' }}>
                {success.length} STYLE{success.length !== 1 ? 'S' : ''} GENERATED
              </Text>
            </View>

            <Text style={{
              fontSize: 30, fontWeight: '800',
              color: '#f0eeff', letterSpacing: -1
            }}>
              Your Cliparts
            </Text>
            <Text style={{ color: '#8880b0', fontSize: 14, marginTop: 4 }}>
              Tap any image to compare with original
            </Text>
          </Animated.View>

          {/* Download All */}
          {success.length > 1 && (
            <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
              <TouchableOpacity
                onPress={downloadAll}
                activeOpacity={0.88}
                style={{ borderRadius: 16, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={['#7c5cfc', '#4f46e5']}
                  style={{
                    paddingVertical: 16, flexDirection: 'row',
                    alignItems: 'center', justifyContent: 'center', gap: 9
                  }}
                >
                  <Download size={18} color="#fff" strokeWidth={2.5} />
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                    Save All ({success.length}) to Gallery
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {results.map(result => (
            <ResultCard
              key={result.style}
              result={result}
              styleInfo={styleMap[result.style]}
              downloading={downloading === result.style}
              originalUri={originalImage?.uri}
              onDownload={() => download(result)}
              onShare={() => share(result)}
              onRetry={retry}
            />
          ))}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}