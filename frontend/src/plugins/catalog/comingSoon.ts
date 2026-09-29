import type { ComingSoonCatalogEntry } from "./types";

export const COMING_SOON: ComingSoonCatalogEntry[] = [
  {
    slug: "lidar-3d-cuboids",
    title: "LiDAR 3D cuboids",
    summary: "Place and orient 3D boxes around objects in point-cloud scenes.",
    family: "3D spatial",
    modalities: ["LiDAR / 3D"],
    useCases: ["Autonomous driving", "Robotics", "Scene understanding"],
  },
  {
    slug: "point-cloud-segmentation",
    title: "Point-cloud segmentation",
    summary: "Assign semantic classes to points or selected 3D regions.",
    family: "3D segmentation",
    modalities: ["LiDAR / 3D"],
    useCases: ["Mapping", "Infrastructure", "Perception datasets"],
  },
];
