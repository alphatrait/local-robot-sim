export const DEFAULT_DIFF_DRIVE_URDF = `<?xml version="1.0"?>
<robot name="diff_drive_box">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="0.7 0.3 0.5"/>
      </geometry>
    </visual>
  </link>

  <link name="left_wheel">
    <visual>
      <geometry>
        <cylinder radius="0.08" length="0.04"/>
      </geometry>
    </visual>
    <collision>
      <geometry>
        <cylinder radius="0.08" length="0.04"/>
      </geometry>
    </collision>
  </link>

  <link name="right_wheel">
    <visual>
      <geometry>
        <cylinder radius="0.08" length="0.04"/>
      </geometry>
    </visual>
    <collision>
      <geometry>
        <cylinder radius="0.08" length="0.04"/>
      </geometry>
    </collision>
  </link>

  <joint name="left_wheel_joint" type="fixed">
    <parent link="base_link"/>
    <child link="left_wheel"/>
    <origin xyz="-0.28 0.08 0" rpy="0 0 0"/>
  </joint>

  <joint name="right_wheel_joint" type="fixed">
    <parent link="base_link"/>
    <child link="right_wheel"/>
    <origin xyz="0.28 0.08 0" rpy="0 0 0"/>
  </joint>
</robot>
`;
